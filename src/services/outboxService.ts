import {
  FEATURE_OFFLINE_OUTBOX,
  OUTBOX_RETRY_BASE_MS,
  OUTBOX_RETRY_MAX_MS,
  OUTBOX_MAX_ATTEMPTS,
} from "@/src/lib/constants";
import { cacheService } from "@/src/services/cacheService";
import { messageService } from "@/src/services/messageService";
import { useChatStore } from "@/src/stores/chatStore";
import type { OutboxItem } from "@/src/types";

/**
 * Offline outbox worker (Phase 5A — design §3, §4, §6, §8).
 *
 * The single owner of *when* to attempt a queued send: it drains the durable
 * outbox head-first per room, single-flights each message, applies bounded
 * backoff on transient failures, parks permanent ones, and re-arms one timer
 * for the soonest blocked head. It never decides queue *state* — that is the
 * repository (`OutboxRepository`, Invariant #3); this service only orchestrates
 * timing/network/retry, mirroring the Phase-4 `syncService`/`mergeMessageWindow`
 * split.
 *
 * Layering: like `syncService`, it reaches persistence only through
 * `cacheService` (never imports `src/db/*`) and patches the store via
 * `getState()`. SQLite writes are fire-and-forget from the render path.
 *
 * Flag delegation (§14): with `FEATURE_OFFLINE_OUTBOX` off the public entry
 * points no-op, so nothing here ever runs — sending stays today's temp-/RAM
 * path byte-for-byte.
 */

// ---------------------------------------------------------------------------
// Module state (rebuilt on relaunch; §8.2). None of this is rendered.
// ---------------------------------------------------------------------------

// Single-flight per message id (§5 layer 4): a message currently being sent is
// never re-picked, so a network + timer wake can't double-drive one id.
const inFlight = new Set<string>();

// Coalesce overlapping wakeups into one pass (§3.4): a wake landing mid-drain
// sets `rerun` so the current pass loops once more instead of racing a second.
let draining = false;
let rerun = false;

// One timer, re-armed for the soonest blocked head across the queue (§3.4 #4).
let timer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Error classification (§3.4): transient (backoff & retry) vs permanent (park).
// ---------------------------------------------------------------------------

function isPermanent(err: unknown): boolean {
  const e = err as { code?: string; status?: number; statusCode?: number };

  // Postgres SQLSTATE class: 42xxx (access/RLS), 23xxx (integrity/FK),
  // 22xxx (data/validation) → can't succeed by retrying.
  const code = typeof e?.code === "string" ? e.code : undefined;
  if (code && (code.startsWith("42") || code.startsWith("23") || code.startsWith("22"))) {
    return true;
  }

  // HTTP status when the error carries one (PostgrestError / fetch wrappers).
  const status = e?.status ?? e?.statusCode;
  if (typeof status === "number") {
    if (status === 408 || status === 429) return false; // timeout / rate limit
    if (status >= 400 && status < 500) return true; // other 4xx → permanent
    return false; // 5xx → transient
  }

  // Unknown (offline / no code / no status) → transient: safe to retry.
  return false;
}

function errorText(err: unknown): string {
  const e = err as { message?: string };
  return e?.message ?? String(err);
}

// ---------------------------------------------------------------------------
// Single-message attempt
// ---------------------------------------------------------------------------

// The outcome the head-first drain needs to decide whether the room unblocks.
// `retry` carries the future time the head is now scheduled for (feeds timer).
type SendOutcome =
  | { kind: "sent" }
  | { kind: "failed" }
  | { kind: "retry"; nextAtMs: number };

async function attemptSend(item: OutboxItem): Promise<SendOutcome> {
  const { message } = item;

  // Single-flight guard: treat an already-in-flight id as still blocking its
  // room (do not double-send). The `draining` coalescing makes this rare.
  if (inFlight.has(message.id)) {
    return { kind: "retry", nextAtMs: Date.now() };
  }
  inFlight.add(message.id);

  try {
    const row = await messageService.sendMessageIdempotent({
      id: message.id,
      room_id: message.room_id,
      content: message.content ?? "",
      type: message.type ?? "text",
      metadata: message.metadata,
      reply_to: message.reply_to ?? null,
      // The stored (monotonic-stamped) authoring instant is the ordering key
      // everywhere (§6.1) — send it so the server row matches the local one.
      created_at: message.created_at ?? new Date().toISOString(),
    });

    // ACK (§4.2): durable txn first (adopt server row → status=sent, delete
    // outbox, advance the messages cursor), then the RAM promotion. Both keyed
    // by id → idempotent against a realtime echo that raced ahead (§4.3).
    await cacheService.markOutboxSent(message.id, row);
    useChatStore.getState().markMessageSent(row);
    return { kind: "sent" };
  } catch (err) {
    return handleSendError(item, err);
  } finally {
    // Cleared only after the ACK txn commits (or the failure is recorded), so a
    // crash between RPC-success and commit simply re-drives (idempotent RPC).
    inFlight.delete(message.id);
  }
}

async function handleSendError(
  item: OutboxItem,
  err: unknown
): Promise<SendOutcome> {
  const { message, attempts } = item;
  const text = errorText(err);

  // Permanent → park immediately, no backoff (§3.4). Manual retry only.
  if (isPermanent(err)) {
    await cacheService.markOutboxFailed(message.id, text, true);
    useChatStore.getState().markMessageFailed(message.id);
    console.error(`[outboxService] permanent failure ${message.id}`, err);
    return { kind: "failed" };
  }

  // Transient: bump attempts; park once the cap is reached (§3.4).
  const nextAttempts = attempts + 1;
  if (nextAttempts >= OUTBOX_MAX_ATTEMPTS) {
    await cacheService.markOutboxFailed(message.id, text, false);
    useChatStore.getState().markMessageFailed(message.id);
    console.error(
      `[outboxService] exhausted ${message.id} after ${nextAttempts} attempts`,
      err
    );
    return { kind: "failed" };
  }

  // Bounded exponential backoff, persisted so the schedule survives restart:
  // min(BASE * 2^(n-1), MAX) → 2s, 4s, 8s, 16s, 30s (then park at the cap).
  const delay = Math.min(
    OUTBOX_RETRY_BASE_MS * 2 ** (nextAttempts - 1),
    OUTBOX_RETRY_MAX_MS
  );
  const nextAtMs = Date.now() + delay;
  await cacheService.rescheduleOutbox(
    message.id,
    nextAttempts,
    new Date(nextAtMs).toISOString(),
    text
  );
  return { kind: "retry", nextAtMs };
}

// ---------------------------------------------------------------------------
// Head-first per-room drain (§3.2, §6.2)
// ---------------------------------------------------------------------------

/**
 * Drain one room's queue in FIFO order. `items` are the room's outbox rows in
 * `created_at` order (pending + failed mixed). Returns the epoch-ms of the
 * head that now blocks the room (feeds the timer), or null if the room is fully
 * drained. A follower is never attempted while an older sibling is pending, so
 * a transient failure on the head blocks the whole room — including across
 * wakeups, because every drain restarts here at the room head.
 */
async function drainRoom(items: OutboxItem[]): Promise<number | null> {
  const now = Date.now();

  for (const item of items) {
    // Parked (failed) rows don't block — skip to the next (§3.4).
    if (item.state === "failed") continue;

    // First pending row = the room head.
    const headAtMs = item.next_attempt_at
      ? new Date(item.next_attempt_at).getTime()
      : 0; // null = due now
    if (headAtMs > now) {
      // Head not due yet → the whole room waits until then.
      return headAtMs;
    }

    const outcome = await attemptSend(item);
    if (outcome.kind === "retry") {
      // Transient: head rescheduled → the room is blocked until then.
      return outcome.nextAtMs;
    }
    // "sent" or "failed" → the head resolved, continue to the next in FIFO.
  }

  return null; // every message in the room is sent or parked
}

/**
 * One drain pass over the whole queue: read the single ordered enumeration,
 * group by room preserving FIFO, drain rooms in parallel. Returns the soonest
 * blocked-head time across all rooms (null = nothing left to schedule).
 */
async function drainOnce(): Promise<number | null> {
  const all = await cacheService.listOutboxAll();
  if (all.length === 0) return null;

  // Group by room, preserving created_at order (listAll is ORDER BY created_at).
  const byRoom = new Map<string, OutboxItem[]>();
  for (const item of all) {
    const list = byRoom.get(item.message.room_id);
    if (list) list.push(item);
    else byRoom.set(item.message.room_id, [item]);
  }

  // Rooms are independent timelines → drain in parallel (§3.2, §6).
  const blocked = await Promise.all([...byRoom.values()].map(drainRoom));

  let soonest: number | null = null;
  for (const at of blocked) {
    if (at != null && (soonest == null || at < soonest)) soonest = at;
  }
  return soonest;
}

function armTimer(soonestMs: number | null): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (soonestMs == null) return; // queue empty / all parked → no wake needed
  const delay = Math.max(0, soonestMs - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void drain();
  }, delay);
}

/**
 * Coalesced drain: only one pass runs at a time; wakeups arriving mid-pass set
 * `rerun` so we loop once more (picks up fresh enqueues) instead of racing.
 * Re-arms the timer for the soonest blocked head afterwards.
 */
async function drain(): Promise<void> {
  if (draining) {
    rerun = true;
    return;
  }
  draining = true;
  let soonest: number | null = null;
  try {
    do {
      rerun = false;
      soonest = await drainOnce();
    } while (rerun);
  } catch (err) {
    console.error("[outboxService] drain", err);
  } finally {
    draining = false;
    armTimer(soonest);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const outboxService = {
  /**
   * Restart recovery (§8.1): rebuild the schedule from the persisted queue and
   * drive due sends. A single head-first drain does exactly this — it attempts
   * every due head, re-arms the timer from `next_attempt_at`, and leaves parked
   * (failed) rows untouched. Awaited by bootstrap; safe to call repeatedly.
   */
  async resume(): Promise<void> {
    if (!FEATURE_OFFLINE_OUTBOX) return;
    await drain();
  },

  /**
   * Wake the worker (§3.4 triggers: enqueue, connectivity regained, foreground).
   * Fire-and-forget; coalesced with any in-flight pass.
   */
  poke(): void {
    if (!FEATURE_OFFLINE_OUTBOX) return;
    void drain();
  },
};

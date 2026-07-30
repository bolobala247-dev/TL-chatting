import {
  FEATURE_DELTA_SYNC,
  DELTA_SYNC_LIMIT,
  MAX_PERSISTED_PER_ROOM,
  DELTA_RETRY_BASE_MS,
  DELTA_RETRY_MAX_MS,
  DELTA_MAX_ATTEMPTS,
  ROOMS_SYNC_SCOPE,
  MESSAGE_WINDOW_SIZE,
  ROOM_CACHE_TRIM_SIZE,
} from "@/src/lib/constants";
import { messageService } from "@/src/services/messageService";
import { roomService } from "@/src/services/roomService";
import { cacheService } from "@/src/services/cacheService";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import type { MessageWithMeta } from "@/src/types";

/**
 * Incremental synchronization orchestrator (Phase 4 — design §2, §17).
 *
 * The single owner of the delta lanes: cursors, per-scope coalescing, bounded
 * retry, gap-overflow fallback, and the merge orchestration. It is the one
 * surface `useRealtime` / room-open / pull-to-refresh call to recover state
 * after a drop; the flag decides *inside* here (§10.4) so flag-off is
 * byte-identical to today's full-refetch behavior.
 *
 * Layering: like `useRealtime`, this orchestrator reads/writes the stores via
 * `getState()` and reaches persistence only through `cacheService`. The merge
 * itself is the repository-owned pure function (via `cacheService.mergeMessages`,
 * §17 C4); cursor advancement is centralized in `cacheService.saveMessages`
 * (§17 C5). It never imports `src/db/*` and never blocks rendering (SQLite
 * writes are fire-and-forget, the RAM patch is synchronous — Invariant #7).
 */

export type SyncScope = "rooms" | "active-room" | { room: string };

// ---------------------------------------------------------------------------
// Coalescing — one in-flight sync per resolved scope (§6.1). A concurrent
// syncNow for the same scope rides the existing promise instead of racing a
// second pull; a completed sync never blocks a fresh one.
// ---------------------------------------------------------------------------
const inFlight = new Map<string, Promise<void>>();

function resolveRoomId(scope: SyncScope): string | null {
  if (scope === "rooms") return null;
  if (scope === "active-room") return useChatStore.getState().activeRoomId;
  return scope.room;
}

function scopeKey(scope: SyncScope): string {
  if (scope === "rooms") return "rooms";
  const roomId = resolveRoomId(scope);
  return roomId ? `room:${roomId}` : "room:none";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded exponential backoff for a delta pull (§6.2). Returns the value on
 * success; after DELTA_MAX_ATTEMPTS failures runs `fallback` exactly once
 * (today's legacy path — never worse than today) and returns `{ ok: false }`.
 * Retries live inside the coalesced in-flight promise, so a newer trigger for
 * the same scope simply awaits this one rather than starting a competing pull.
 */
async function withRetry<T>(
  key: string,
  task: () => Promise<T>,
  fallback: () => Promise<void>
): Promise<{ ok: true; value: T } | { ok: false }> {
  for (let attempt = 1; attempt <= DELTA_MAX_ATTEMPTS; attempt++) {
    try {
      return { ok: true, value: await task() };
    } catch (err) {
      console.error(`[syncService] ${key} attempt ${attempt}`, err);
      if (attempt < DELTA_MAX_ATTEMPTS) {
        await sleep(
          Math.min(DELTA_RETRY_BASE_MS * 2 ** (attempt - 1), DELTA_RETRY_MAX_MS)
        );
      }
    }
  }
  try {
    await fallback();
  } catch (err) {
    console.error(`[syncService] ${key} fallback`, err);
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Message delta (§2.2)
// ---------------------------------------------------------------------------

/**
 * Merge a server delta batch into the resident window (§4.3, §17 C4).
 * SQLite is written regardless of residency (a later open hydrates from it);
 * `cacheService.saveMessages` also advances the per-room cursor centrally
 * (§17 C5). RAM is patched only if the room is resident, reusing the
 * repository-owned merge (dedup, server-wins, embed-preserve, sort, cap).
 */
function applyServerMessages(roomId: string, rows: MessageWithMeta[]): void {
  if (rows.length === 0) return;

  // Persist + advance cursor (idempotent upsert; tombstones ride along)
  cacheService.saveMessages(rows);

  const chat = useChatStore.getState();
  const current = chat.messages[roomId];
  if (!current) return; // room evicted / never opened → SQLite is enough

  const cap =
    chat.activeRoomId === roomId ? MESSAGE_WINDOW_SIZE : ROOM_CACHE_TRIM_SIZE;
  chat.setRoomMessages(roomId, cacheService.mergeMessages(current, rows, cap));

  // Keep disk history bounded after a delta apply (roadmap §7)
  cacheService.pruneRoom(roomId, MAX_PERSISTED_PER_ROOM);
}

async function syncRoom(roomId: string): Promise<void> {
  const legacyPageFetch = () => useChatStore.getState().fetchMessages(roomId);

  // Flag off ⇒ exactly today's reconnect recovery (§10.4)
  if (!FEATURE_DELTA_SYNC) {
    await legacyPageFetch();
    return;
  }

  // Warm = the room's window is resident in RAM (Invariant #9); a delta only
  // patches an already-painted window (applyServerMessages skips RAM when the
  // room isn't resident). Cold/evicted/never-opened rooms, and rooms without a
  // cursor, take the page fetch (Invariant #8, §3.4 rule 1, §17 C6) — which
  // paints, hydrates, and (re-)seeds the cursor via write-through.
  const resident =
    (useChatStore.getState().messages[roomId] ?? []).length > 0;
  const since = (await cacheService.getSyncState(roomId))?.last_synced_at;
  if (!resident || !since) {
    await legacyPageFetch();
    return;
  }

  const result = await withRetry(
    `room:${roomId}`,
    () => messageService.getRoomMessagesSince(roomId, since, DELTA_SYNC_LIMIT),
    legacyPageFetch
  );
  if (!result.ok) return; // retries exhausted → fallback already ran

  const rows = result.value;

  // Gap overflow: a full batch means we can't guarantee contiguity → mark
  // older history stale and degrade to the known-good page-1 path (§4.4).
  if (rows.length >= DELTA_SYNC_LIMIT) {
    await cacheService.setSyncState(roomId, {
      stale: true,
      has_full_history: false,
    });
    await legacyPageFetch();
    return;
  }

  applyServerMessages(roomId, rows);
}

// ---------------------------------------------------------------------------
// Room-list delta (§2.3)
// ---------------------------------------------------------------------------

/**
 * Advance the room-list cursor to the newest `last_message_at` across the
 * current list. That column is a pure server timestamp (messages.created_at),
 * keeping the cursor server-authored (Invariant #4) and monotonic. Read-state-
 * only changes carry no timestamp in RoomWithLastMessage, so a room changed
 * solely by a read move may be re-returned next delta — harmless, applyRoomsDelta
 * is idempotent; own read/bookmark moves are covered by the realtime path.
 */
async function advanceRoomsCursor(): Promise<void> {
  let max: string | null = null;
  for (const r of useRoomStore.getState().rooms) {
    if (r.last_message_at && (max === null || r.last_message_at > max)) {
      max = r.last_message_at;
    }
  }
  if (max) {
    await cacheService.setSyncState(ROOMS_SYNC_SCOPE, { last_synced_at: max });
  }
}

async function syncRooms(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;

  const legacyFullFetch = () => useRoomStore.getState().fetchRooms(userId);

  // Flag off ⇒ exactly today's foreground/reconnect resync (§10.4)
  if (!FEATURE_DELTA_SYNC) {
    await legacyFullFetch();
    return;
  }

  const since = (await cacheService.getSyncState(ROOMS_SYNC_SCOPE))
    ?.last_synced_at;

  // No list cursor yet → full fetch, then seed the cursor from the list max.
  if (!since) {
    await legacyFullFetch();
    await advanceRoomsCursor();
    return;
  }

  const result = await withRetry(
    "rooms",
    () => roomService.getRoomsDelta(userId, since),
    legacyFullFetch
  );
  if (!result.ok) return;

  if (result.value.length === 0) return; // silent no-op

  useRoomStore.getState().applyRoomsDelta(result.value);
  await advanceRoomsCursor();
}

async function doSync(scope: SyncScope): Promise<void> {
  if (scope === "rooms") {
    await syncRooms();
    return;
  }
  const roomId = resolveRoomId(scope);
  if (!roomId) return; // 'active-room' with no room open → nothing to sync
  await syncRoom(roomId);
}

export const syncService = {
  /**
   * Recover a scope after a drop/foreground/room-open/pull-refresh. Coalesced
   * per scope; fire-and-forget from the UI (never awaited on the render path).
   */
  syncNow(scope: SyncScope): Promise<void> {
    const key = scopeKey(scope);
    const existing = inFlight.get(key);
    if (existing) return existing;
    const p = doSync(scope).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  },

  // Exported for tests (§10.2): the pure-ish merge orchestration.
  applyServerMessages,
};

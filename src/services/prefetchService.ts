import { AppState, InteractionManager } from "react-native";
import { Image } from "expo-image";
import {
  FEATURE_INTELLIGENT_PREFETCH,
  MESSAGES_PER_PAGE,
  IMAGE_PREFETCH_COUNT,
  PREFETCH_ROOM_WARM_COUNT,
  PREFETCH_MAX_CONCURRENT,
  PREFETCH_MEDIA_MAX_CONCURRENT,
  PREFETCH_IDLE_DELAY_MS,
} from "@/src/lib/constants";
import { cacheService } from "@/src/services/cacheService";
import { syncService } from "@/src/services/syncService";
import { diag } from "@/src/lib/diagnostics";
import { useRoomStore } from "@/src/stores/roomStore";
import { useRoomOpenStats } from "@/src/stores/roomOpenStats";
import type { MessageAttachment, MessageWithMeta } from "@/src/types";

/**
 * Centralized prefetch scheduler (Phase 10 — design §8).
 *
 * A single module-level singleton (same idiom as `syncService`) that is the
 * only place deciding execution order and concurrency for speculative warming.
 * It owns NO data and issues NO new queries — every task's `run` delegates to
 * existing services (`cacheService`, `syncService`, `Image.prefetch`), so RLS,
 * coalescing, cursors, dedup and caps are all inherited.
 *
 * Three contracts keep it safe to call from any seam:
 *  - Zero-cost when disabled: with FEATURE_INTELLIGENT_PREFETCH off every public
 *    method's first statement is the flag check, so a trigger is one boolean read
 *    and behavior is byte-identical to today.
 *  - Never load-bearing: no correctness path depends on a prefetch having run;
 *    cancelling/failing any task only falls back to the on-demand path.
 *  - Never blocks render: all work is fire-and-forget off the commit path,
 *    non-CRITICAL tasks run inside `InteractionManager.runAfterInteractions`, and
 *    the pump yields between tasks so a long queue can't monopolize the JS thread.
 */

export type PrefetchTier = "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | "IDLE";
type PrefetchLane = "data" | "media";

export interface PrefetchTask {
  /** Dedup id — a queued/in-flight task with the same key is not re-added. */
  key: string;
  /** Cancellation group, e.g. `press` / `launch` / `list` / `room:${id}`. */
  scope: string;
  tier: PrefetchTier;
  /** Concurrency lane (independent caps). Defaults to "data". */
  lane?: PrefetchLane;
  /** Delegates to existing services; must honor the AbortSignal. */
  run: (signal: AbortSignal) => Promise<void>;
}

const TIER_RANK: Record<PrefetchTier, number> = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
  IDLE: 4,
};

// LOW/IDLE tiers only drain during idle gaps (§8.5).
function isIdleTier(tier: PrefetchTier): boolean {
  return tier === "LOW" || tier === "IDLE";
}

// ---------------------------------------------------------------------------
// Queue + run state
// ---------------------------------------------------------------------------
const queue: PrefetchTask[] = [];
const controllers = new Map<string, AbortController>(); // key → in-flight signal
const activeKeys = new Set<string>(); // queued OR running (dedup authority)
const running: Record<PrefetchLane, number> = { data: 0, media: 0 };
const laneCap: Record<PrefetchLane, number> = {
  data: PREFETCH_MAX_CONCURRENT,
  media: PREFETCH_MEDIA_MAX_CONCURRENT,
};

// Pause is driven by AppState (background) and the public pause/resume seam
// (reserved for a NetInfo/battery driver). Paused ⇒ the pump drains nothing.
let paused = false;
let lastScheduleAt = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let appStateBound = false;

function laneOf(task: PrefetchTask): PrefetchLane {
  return task.lane ?? "data";
}

function bindAppState(): void {
  if (appStateBound) return;
  appStateBound = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") resume();
    else pause();
  });
}

// Ordered insert: tier rank, then FIFO within a tier (stable by arrival).
function enqueue(task: PrefetchTask): void {
  const rank = TIER_RANK[task.tier];
  let i = queue.length;
  while (i > 0 && TIER_RANK[queue[i - 1].tier] > rank) i--;
  queue.splice(i, 0, task);
}

function pump(): void {
  if (paused) return;

  // Idle-tier gating: LOW/IDLE only after a quiet debounce (§8.5). If the head
  // eligible task is idle-tier and we're still inside the debounce, re-pump later.
  for (let i = 0; i < queue.length; i++) {
    const task = queue[i];
    const lane = laneOf(task);
    if (running[lane] >= laneCap[lane]) continue;

    if (isIdleTier(task.tier)) {
      const quietFor = Date.now() - lastScheduleAt;
      if (quietFor < PREFETCH_IDLE_DELAY_MS) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(pump, PREFETCH_IDLE_DELAY_MS - quietFor);
        continue;
      }
    }

    queue.splice(i, 1);
    void start(task);
    i = -1; // restart scan — lane counts changed
  }
}

async function start(task: PrefetchTask): Promise<void> {
  const lane = laneOf(task);
  running[lane] += 1;

  const controller = new AbortController();
  controllers.set(task.key, controller);

  const execute = async () => {
    const started = Date.now();
    try {
      await task.run(controller.signal);
    } catch (err) {
      console.error(`[prefetchService] ${task.key}`, err);
    } finally {
      controllers.delete(task.key);
      activeKeys.delete(task.key);
      running[lane] -= 1;
      diag.observe("prefetch.duration.ms", Date.now() - started, {
        tier: task.tier,
      });
      diag.gauge("prefetch.running", running.data + running.media);
      // Yield so a long queue never monopolizes the JS thread (§8.4).
      setTimeout(pump, 0);
    }
  };

  // CRITICAL may start immediately (still async); everything else defers behind
  // active gestures/animations so user work always wins (§8.4).
  if (task.tier === "CRITICAL") {
    void execute();
  } else {
    InteractionManager.runAfterInteractions(() => void execute());
  }
}

// ---------------------------------------------------------------------------
// Warm-set selection (recency + frequency + bookmarked, §2)
// ---------------------------------------------------------------------------
let lastListKeys: string[] = [];

function computeWarmRoomIds(): string[] {
  const rooms = useRoomStore.getState().rooms;
  if (rooms.length === 0) return [];

  // The list is already sorted bookmarked-first then by last_message_at, so the
  // top slice is the best cheap recency predictor (§2.1/§2.2).
  const ids = new Set<string>();
  for (let i = 0; i < rooms.length && ids.size < PREFETCH_ROOM_WARM_COUNT; i++) {
    ids.add(rooms[i].room_id);
  }
  // Bookmarked rooms are always warm (explicit intent, §2.4).
  for (const r of rooms) {
    if (r.bookmarked_at) ids.add(r.room_id);
  }
  // Blend in up to 2 "frequent but not recent" rooms (§2.3), still visible.
  const frequent = useRoomOpenStats.getState().topRoomIds(2);
  for (const id of frequent) {
    if (rooms.some((r) => r.room_id === id)) ids.add(id);
  }
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Task factories — delegate-only warming (§2.8, §3.3, §4)
// ---------------------------------------------------------------------------

function roomWarmRun(roomId: string) {
  return async (signal: AbortSignal): Promise<void> => {
    // 1) A fresh disk window with a cursor is "warm enough" — skip network.
    const cached = await cacheService.getRoomMessages(roomId, MESSAGES_PER_PAGE);
    if (signal.aborted) return;
    const sync = await cacheService.getSyncState(roomId);
    if (signal.aborted) return;
    if (cached.length > 0 && sync?.last_synced_at) {
      diag.count("prefetch.hit", 1, { kind: "room" });
      return;
    }
    // 2) Otherwise route through syncService — same path (and cursor) a real
    //    open takes, just earlier; coalesced so a real open reuses this pull.
    await syncService.syncNow({ room: roomId });
  };
}

function collectImageUrls(rows: MessageWithMeta[]): string[] {
  const urls: string[] = [];
  for (const m of rows) {
    if (urls.length >= IMAGE_PREFETCH_COUNT) break;
    const attachments = m.attachments as MessageAttachment[] | null;
    if (!Array.isArray(attachments)) continue;
    for (const a of attachments) {
      if (urls.length >= IMAGE_PREFETCH_COUNT) break;
      if (a.kind != null && a.kind !== "image") continue;
      if (typeof a.url === "string" && a.url.startsWith("http")) urls.push(a.url);
    }
  }
  return urls;
}

export const prefetchService = {
  /**
   * Enqueue a task (fire-and-forget). De-dupes by `key`. No-op when the flag is
   * off or the key is already queued/in-flight.
   */
  schedule(task: PrefetchTask): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    if (activeKeys.has(task.key)) {
      diag.count("prefetch.deduped", 1, { tier: task.tier });
      return;
    }
    bindAppState();
    activeKeys.add(task.key);
    enqueue(task);
    lastScheduleAt = Date.now();
    diag.count("prefetch.scheduled", 1, { tier: task.tier });
    pump();
  },

  /** Abort/drop a single task by key. */
  cancel(key: string): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    const idx = queue.findIndex((t) => t.key === key);
    if (idx !== -1) queue.splice(idx, 1);
    controllers.get(key)?.abort();
    controllers.delete(key);
    activeKeys.delete(key);
    diag.count("prefetch.cancelled", 1);
  },

  /** Abort/drop every task in a cancellation group (e.g. on room switch). */
  cancelScope(scope: string): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].scope === scope) {
        activeKeys.delete(queue[i].key);
        queue.splice(i, 1);
      }
    }
    for (const [key, controller] of controllers) {
      // Best-effort: controllers don't carry scope, so match by the key prefix
      // convention `scope:...` used by the factories below.
      if (key.startsWith(`${scope}:`) || key === scope) {
        controller.abort();
        controllers.delete(key);
        activeKeys.delete(key);
      }
    }
    diag.count("prefetch.cancelled", 1, { scope });
  },

  // -------------------------------------------------------------------------
  // High-level triggers (thin factories over schedule)
  // -------------------------------------------------------------------------

  /** Warm one room's newest window. `scope`/`tier` set the cancellation group. */
  warmRoom(
    roomId: string,
    opts?: { tier?: PrefetchTier; scope?: string }
  ): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    const scope = opts?.scope ?? `room:${roomId}`;
    this.schedule({
      key: `room:${roomId}`,
      scope,
      tier: opts?.tier ?? "NORMAL",
      run: roomWarmRun(roomId),
    });
  },

  /** Recompute the warm set and enqueue any newly-hot rooms (list-change diff). */
  warmRoomList(): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    const ids = computeWarmRoomIds();
    // Cancel queued (not-yet-started) warms that dropped out of the set.
    for (const prev of lastListKeys) {
      if (!ids.includes(prev)) this.cancel(`room:${prev}`);
    }
    lastListKeys = ids;
    for (const id of ids) this.warmRoom(id, { tier: "HIGH", scope: "list" });
  },

  /** Warm the window around a search-jump target (Phase 9 `?focus=&at=`). */
  warmSearchAround(roomId: string, at: string): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    this.schedule({
      key: `search:${roomId}:${at}`,
      scope: `room:${roomId}`,
      tier: "HIGH",
      run: async (signal) => {
        const win = await cacheService.getRoomMessagesAround(
          roomId,
          at,
          MESSAGES_PER_PAGE
        );
        if (signal.aborted) return;
        if (win.length > 0) {
          diag.count("prefetch.hit", 1, { kind: "search" });
          return;
        }
        await syncService.syncNow({ room: roomId });
      },
    });
  },

  /** Warm expo-image's disk cache for a room's newest image attachments. */
  warmRoomMedia(
    roomId: string,
    opts?: { tier?: PrefetchTier; scope?: string }
  ): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    const scope = opts?.scope ?? `room:${roomId}`;
    this.schedule({
      key: `media:room:${roomId}`,
      scope,
      tier: opts?.tier ?? "NORMAL",
      lane: "media",
      run: async (signal) => {
        const rows = await cacheService.getRoomMessages(
          roomId,
          MESSAGES_PER_PAGE
        );
        if (signal.aborted) return;
        const urls = collectImageUrls(rows);
        if (urls.length === 0) return;
        try {
          await Image.prefetch(urls);
        } catch {
          // best-effort cache warm only
        }
      },
    });
  },

  /**
   * Re-evaluate the warm set after a wakeup (reconnect/foreground/list change).
   * Called from the same seam as `outboxService.poke()` / `mediaService.poke()`.
   */
  poke(_reason?: string): void {
    if (!FEATURE_INTELLIGENT_PREFETCH) return;
    this.warmRoomList();
  },

  /** Suspend draining (AppState background / NetInfo offline / low battery). */
  pause(): void {
    paused = true;
  },

  /** Resume draining and re-pump. */
  resume(): void {
    paused = false;
    pump();
  },
};

// Module-private resume used by the AppState binding (keeps `this` off the path).
function resume(): void {
  prefetchService.resume();
}
function pause(): void {
  prefetchService.pause();
}

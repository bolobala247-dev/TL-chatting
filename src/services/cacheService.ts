import { databaseService } from "@/src/services/databaseService";
import { mergeMessageWindow } from "@/src/db/repositories/merge";
import { diag } from "@/src/lib/diagnostics";
import type {
  MessageWithMeta,
  OutboxItem,
  RoomWithLastMessage,
  SyncState,
} from "@/src/types";

/**
 * Domain-facing facade over the local cache (Phase 3 — hydration).
 *
 * Layering (unchanged from Phase 2): stores call THIS service; this service
 * reaches SQLite only through the repositories that databaseService exposes.
 * SQLite never touches the store/UI layers directly — the memory store stays
 * the single source of truth for rendering, SQLite is persistence only.
 *
 *   Render:  SQLite → repository → (here) → memory store → UI
 *   Ingest:  Supabase → store    → (here) → repository   → SQLite
 *
 * Every method is best-effort and never throws:
 *  - reads return empty results when the cache is unavailable or broken,
 *  - writes are fire-and-forget — rendering must never await them.
 * Cache off (web, init failure) therefore means exactly today's
 * network-first behavior.
 */

// Optimistic messages carry a client-side `temp-` id and must never be
// persisted (no outbox in this phase — pending sends don't survive restarts).
function isPersistable(message: MessageWithMeta): boolean {
  return !message.id.startsWith("temp-");
}

// Highest server `updated_at` per room across a batch — the value each room's
// sync cursor advances to (§17 C5). Rows without an updated_at are ignored.
function maxUpdatedAtByRoom(messages: MessageWithMeta[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (!m.updated_at) continue;
    const current = map.get(m.room_id);
    if (current == null || m.updated_at > current) {
      map.set(m.room_id, m.updated_at);
    }
  }
  return map;
}

// Fire-and-forget: advance every touched room's messages cursor forward. The
// repository `set` is monotonic, so an out-of-order batch never regresses it.
function advanceMessageCursors(messages: MessageWithMeta[]): void {
  const repos = databaseService.repositories;
  if (!repos) return;
  for (const [roomId, max] of maxUpdatedAtByRoom(messages)) {
    void repos.syncState
      .set(roomId, { last_synced_at: max })
      .catch((err) => console.error("[cacheService] advance cursor", err));
  }
}

export const cacheService = {
  // -------------------------------------------------------------------------
  // Reads (hydration)
  // -------------------------------------------------------------------------

  /** Cached room list in room-list order; [] when the cache is unavailable. */
  async getRooms(): Promise<RoomWithLastMessage[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.rooms.getAll();
    } catch (err) {
      console.error("[cacheService] getRooms", err);
      return [];
    }
  },

  /** Newest `limit` cached messages of a room (newest-first); [] when unavailable. */
  async getRoomMessages(
    roomId: string,
    limit: number
  ): Promise<MessageWithMeta[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.messages.getPageByRoom(roomId, limit);
    } catch (err) {
      console.error("[cacheService] getRoomMessages", err);
      return [];
    }
  },

  // -------------------------------------------------------------------------
  // Writes (write-through, fire-and-forget)
  // -------------------------------------------------------------------------

  /** Persist a fresh full get_user_rooms snapshot (replaces the cached list). */
  saveRooms(rooms: RoomWithLastMessage[]): void {
    const repos = databaseService.repositories;
    if (!repos) return;
    void repos.rooms
      .replaceAll(rooms)
      .catch((err) => console.error("[cacheService] saveRooms", err));
  },

  /**
   * Persist a fresh page-1 result: refreshes the newest cached window so
   * rows deleted server-side don't linger (see replaceNewestWindow).
   */
  saveMessagePage(roomId: string, messages: MessageWithMeta[]): void {
    const repos = databaseService.repositories;
    if (!repos) return;
    const rows = messages.filter(isPersistable);
    void repos.messages
      .replaceNewestWindow(roomId, rows)
      .catch((err) => console.error("[cacheService] saveMessagePage", err));
    // Advance the room cursor to the newest updated_at just persisted (§17 C5)
    advanceMessageCursors(rows);
  },

  /** Upsert individual messages (older pages, realtime events, confirmed sends). */
  saveMessages(messages: MessageWithMeta[]): void {
    const repos = databaseService.repositories;
    if (!repos) return;
    const rows = messages.filter(isPersistable);
    if (rows.length === 0) return;
    void repos.messages
      .upsertMany(rows)
      .catch((err) => console.error("[cacheService] saveMessages", err));
    // Every ingest point funnels through here, so this single call makes all
    // user-visible mutations advance the cursor (Invariant #5, §17 C5)
    advanceMessageCursors(rows);
  },

  /** Remove one message from the cache (hard delete / undo send). */
  deleteMessage(messageId: string): void {
    const repos = databaseService.repositories;
    if (!repos || messageId.startsWith("temp-")) return;
    void repos.messages
      .deleteById(messageId)
      .catch((err) => console.error("[cacheService] deleteMessage", err));
  },

  /** Cap a room's persisted history (disk trim after a delta apply). */
  pruneRoom(roomId: string, keep: number): void {
    const repos = databaseService.repositories;
    if (!repos) return;
    void repos.messages
      .pruneRoom(roomId, keep)
      .catch((err) => console.error("[cacheService] pruneRoom", err));
  },

  // -------------------------------------------------------------------------
  // Incremental sync (Phase 4) — cursors + repository-owned merge
  // -------------------------------------------------------------------------

  /** Read a scope's sync cursor; null when unset or the cache is unavailable. */
  async getSyncState(scopeId: string): Promise<SyncState | null> {
    const repos = databaseService.repositories;
    if (!repos) return null;
    try {
      return await repos.syncState.get(scopeId);
    } catch (err) {
      console.error("[cacheService] getSyncState", err);
      return null;
    }
  },

  /** Upsert a scope's sync cursor (never throws; monotonic last_synced_at). */
  async setSyncState(
    scopeId: string,
    patch: Partial<Omit<SyncState, "scope_id">>
  ): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.syncState.set(scopeId, patch);
    } catch (err) {
      console.error("[cacheService] setSyncState", err);
    }
  },

  /**
   * Repository-owned batch merge (Invariant #3, §17 C4): reconcile a server
   * delta into an existing in-memory window. Pure and idempotent — exposed
   * here so the service layer never imports `src/db/*` directly.
   */
  mergeMessages(
    existing: MessageWithMeta[],
    incoming: MessageWithMeta[],
    cap: number
  ): MessageWithMeta[] {
    return mergeMessageWindow(existing, incoming, cap);
  },

  // -------------------------------------------------------------------------
  // Outbox (Phase 5A) — durable send queue, never-throw wrappers
  // -------------------------------------------------------------------------
  //
  // 1:1 facade over OutboxRepository so the service/store layers never import
  // src/db/* directly. Writes never throw: if the cache is unavailable (web,
  // init failure) or a write fails, the send degrades to today's in-RAM
  // optimistic behavior (F9/F10) — the message still shows, just without
  // durability. Reads return [] when unavailable.

  /** Persist a pending send (message row status=pending + outbox row, one txn). */
  async enqueueOutbox(message: MessageWithMeta, createdAt: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.outbox.enqueue(message, createdAt);
      diag.count("outbox.enqueued", 1);
    } catch (err) {
      console.error("[cacheService] enqueueOutbox", err);
    }
  },

  /** Every outbox item (pending + failed), FIFO by created_at; [] when
   * unavailable. The one enumeration the worker drains head-first (§3.2) and
   * resume() rebuilds timers from (§8.1). */
  async listOutboxAll(): Promise<OutboxItem[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.outbox.listAll();
    } catch (err) {
      console.error("[cacheService] listOutboxAll", err);
      return [];
    }
  },

  /** ACK: adopt the server row (status=sent) + delete the outbox row, one txn. */
  async markOutboxSent(id: string, serverRow: MessageWithMeta): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.outbox.markSent(id, serverRow);
      // Adopting the server row is the one outbox transition that advances the
      // messages sync cursor (§9.2): un-ACKed rows never do, so a pending local
      // row can't poison the server-authored delta cursor (Invariant #4).
      advanceMessageCursors([serverRow]);
    } catch (err) {
      console.error("[cacheService] markOutboxSent", err);
    }
  },

  /** Park a send as FAILED (message.status=failed + outbox.state=failed). */
  async markOutboxFailed(
    id: string,
    error: string,
    permanent: boolean
  ): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.outbox.markFailed(id, error, permanent);
    } catch (err) {
      console.error("[cacheService] markOutboxFailed", err);
    }
  },

  /** Transient retry: bump attempts + persist next_attempt_at (stays pending). */
  async rescheduleOutbox(
    id: string,
    attempts: number,
    nextAttemptAt: string,
    error: string
  ): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.outbox.reschedule(id, attempts, nextAttemptAt, error);
    } catch (err) {
      console.error("[cacheService] rescheduleOutbox", err);
    }
  },

  /** Discard a pending/failed send: delete the message row + outbox row, one txn. */
  async removeOutbox(id: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.outbox.remove(id);
    } catch (err) {
      console.error("[cacheService] removeOutbox", err);
    }
  },

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Logout: close + delete the database file (cached plaintext must not
   * survive an account switch), then reopen an empty one so the next login
   * in the same app run gets a working cache. Never throws.
   */
  async wipe(): Promise<void> {
    await databaseService.wipe();
    await databaseService.init();
  },
};

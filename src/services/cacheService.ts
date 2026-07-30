import { databaseService } from "@/src/services/databaseService";
import type { MessageWithMeta, RoomWithLastMessage } from "@/src/types";

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
    void repos.messages
      .replaceNewestWindow(roomId, messages.filter(isPersistable))
      .catch((err) => console.error("[cacheService] saveMessagePage", err));
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
  },

  /** Remove one message from the cache (hard delete / undo send). */
  deleteMessage(messageId: string): void {
    const repos = databaseService.repositories;
    if (!repos || messageId.startsWith("temp-")) return;
    void repos.messages
      .deleteById(messageId)
      .catch((err) => console.error("[cacheService] deleteMessage", err));
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

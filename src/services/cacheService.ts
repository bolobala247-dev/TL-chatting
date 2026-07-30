import { databaseService } from "@/src/services/databaseService";
import { searchIndexer } from "@/src/services/searchIndexer";
import { mergeMessageWindow } from "@/src/db/repositories/merge";
import { diag } from "@/src/lib/diagnostics";
import type {
  MessageAttachment,
  MessageWithMeta,
  OutboxItem,
  RoomWithLastMessage,
  SyncState,
  UploadTask,
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

  /**
   * A cached window centered on a message time (Phase 9 §3.3): up to `radius`
   * rows each side of `around`, newest-first. Lets scroll restore / search-jump
   * bring a deep target into the resident window in one read. [] when unavailable.
   */
  async getRoomMessagesAround(
    roomId: string,
    around: string,
    radius: number
  ): Promise<MessageWithMeta[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.messages.getWindowAround(roomId, around, radius);
    } catch (err) {
      console.error("[cacheService] getRoomMessagesAround", err);
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
    // Reconcile the search index for the same window (Phase 8B §6) — beside the
    // cursor seam, fire-and-forget, flag-gated inside the indexer.
    void searchIndexer.applyPage(roomId, rows);
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
    // …and index the same batch for local search (Phase 8B §6) — the indexer
    // rides this exact seam, fire-and-forget, flag-gated internally.
    void searchIndexer.apply(rows);
  },

  /** Remove one message from the cache (hard delete / undo send). */
  deleteMessage(messageId: string): void {
    const repos = databaseService.repositories;
    if (!repos || messageId.startsWith("temp-")) return;
    void repos.messages
      .deleteById(messageId)
      .catch((err) => console.error("[cacheService] deleteMessage", err));
    // Evict from the search index too (Phase 8B §6) — matches the RPC's
    // deleted_at filter so a recalled message never surfaces.
    void searchIndexer.remove(messageId);
  },

  /** Cap a room's persisted history (disk trim after a delta apply). */
  pruneRoom(roomId: string, keep: number): void {
    const repos = databaseService.repositories;
    if (!repos) return;
    void repos.messages
      .pruneRoom(roomId, keep)
      .catch((err) => console.error("[cacheService] pruneRoom", err));
    // Prune the index in lockstep so it never indexes more than the cache holds
    // (Phase 8B §2.2 r4 — the index is bounded by the cache by construction).
    void searchIndexer.pruneRoom(roomId, keep);
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
  // Upload queue (Phase 7B) — media work list, never-throw wrappers
  // -------------------------------------------------------------------------
  //
  // 1:1 facade over UploadQueueRepository, same contract as the outbox
  // wrappers: the service/store layers never import src/db/* directly, and
  // failures degrade to "no durable queue" (mediaService gates on the flag +
  // cache availability, so a broken cache simply keeps the legacy send path).

  /** Persist a media message (status=pending) + its upload tasks, one txn. */
  async enqueueUploads(
    message: MessageWithMeta,
    tasks: UploadTask[]
  ): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) throw new Error("local cache unavailable");
    // Unlike the other wrappers this THROWS on failure: staging succeeded but
    // durability failed → the caller must remove the RAM bubble (design M9)
    // rather than show a message that would silently vanish on restart.
    await repos.uploadQueue.enqueueMessageWithUploads(message, tasks);
    // §16 diagnostics: per-kind enqueue counter (observe-only, never branched).
    const byKind = new Map<string, number>();
    for (const t of tasks) byKind.set(t.kind, (byKind.get(t.kind) ?? 0) + 1);
    for (const [kind, n] of byKind) diag.count("media.enqueued", n, { kind });
  },

  /** Active (queued|uploading) tasks, global FIFO; [] when unavailable. */
  async listActiveUploads(): Promise<UploadTask[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.uploadQueue.listActive();
    } catch (err) {
      console.error("[cacheService] listActiveUploads", err);
      return [];
    }
  },

  /** Every task of one message, position order; [] when unavailable. */
  async listUploadsForMessage(messageId: string): Promise<UploadTask[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.uploadQueue.listForMessage(messageId);
    } catch (err) {
      console.error("[cacheService] listUploadsForMessage", err);
      return [];
    }
  },

  /** Messages fully uploaded but not yet handed off (crash window, M5). */
  async listCompletableUploadMessageIds(): Promise<string[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.uploadQueue.listCompletableMessageIds();
    } catch (err) {
      console.error("[cacheService] listCompletableUploadMessageIds", err);
      return [];
    }
  },

  /** Messages already ACKed (or gone) that still hold queue rows (rule 7). */
  async listSentUploadMessageIds(): Promise<string[]> {
    const repos = databaseService.repositories;
    if (!repos) return [];
    try {
      return await repos.uploadQueue.listSentMessageIds();
    } catch (err) {
      console.error("[cacheService] listSentUploadMessageIds", err);
      return [];
    }
  },

  /** Crash recovery: stale 'uploading' rows → 'queued' (idempotent PUT). */
  async revertStaleUploads(): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.revertUploadingToQueued();
    } catch (err) {
      console.error("[cacheService] revertStaleUploads", err);
    }
  },

  async markUploadUploading(id: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.markUploading(id);
    } catch (err) {
      console.error("[cacheService] markUploadUploading", err);
    }
  },

  async markUploadUploaded(
    id: string,
    remotePath: string,
    remoteUrl: string
  ): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.markUploaded(id, remotePath, remoteUrl);
    } catch (err) {
      console.error("[cacheService] markUploadUploaded", err);
    }
  },

  /** Transient retry: bump attempts + persist next_attempt_at (back to queued). */
  async rescheduleUpload(
    id: string,
    attempts: number,
    nextAttemptAt: string,
    error: string
  ): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.reschedule(id, attempts, nextAttemptAt, error);
    } catch (err) {
      console.error("[cacheService] rescheduleUpload", err);
    }
  },

  /** Permanent/exhausted: park the task + owning message (status=failed). */
  async markUploadFailed(id: string, error: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.markFailed(id, error);
    } catch (err) {
      console.error("[cacheService] markUploadFailed", err);
    }
  },

  /** Manual retry: failed tasks → queued/attempts=0, message → pending. */
  async resetUploadsForRetry(messageId: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.resetForRetry(messageId);
    } catch (err) {
      console.error("[cacheService] resetUploadsForRetry", err);
    }
  },

  /** {total, uploaded, failed} for one message; zeros when unavailable. */
  async getUploadCompletion(
    messageId: string
  ): Promise<{ total: number; uploaded: number; failed: number }> {
    const repos = databaseService.repositories;
    if (!repos) return { total: 0, uploaded: 0, failed: 0 };
    try {
      return await repos.uploadQueue.getMessageCompletion(messageId);
    } catch (err) {
      console.error("[cacheService] getUploadCompletion", err);
      return { total: 0, uploaded: 0, failed: 0 };
    }
  },

  /** Completion gate: rewrite attachments to remote + insert outbox row, one txn. */
  async completeUploadsForMessage(
    messageId: string,
    rewrittenAttachments: MessageAttachment[]
  ): Promise<boolean> {
    const repos = databaseService.repositories;
    if (!repos) return false;
    try {
      await repos.uploadQueue.completeMessage(messageId, rewrittenAttachments);
      return true;
    } catch (err) {
      console.error("[cacheService] completeUploadsForMessage", err);
      return false;
    }
  },

  /** Discard: queue rows + message row, one txn. */
  async removeUploadsForMessage(messageId: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.removeForMessage(messageId);
    } catch (err) {
      console.error("[cacheService] removeUploadsForMessage", err);
    }
  },

  /** Post-ACK cleanup: queue rows only — the sent message stays. */
  async clearSentUploads(messageId: string): Promise<void> {
    const repos = databaseService.repositories;
    if (!repos) return;
    try {
      await repos.uploadQueue.clearSent(messageId);
    } catch (err) {
      console.error("[cacheService] clearSentUploads", err);
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

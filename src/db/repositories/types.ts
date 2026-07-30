import type {
  MessageAttachment,
  MessageWithMeta,
  OutboxItem,
  RoomParticipantWithProfile,
  RoomWithLastMessage,
  SearchDoc,
  SearchQuery,
  SearchResultSet,
  SyncState,
  UploadTask,
} from "@/src/types";

/**
 * Repository contracts for the local cache (Phase 2 foundation).
 *
 * These interfaces are the abstraction boundary between the application
 * layer (services) and the storage engine: higher layers depend on these
 * types only, so a future phase can swap the SQLite implementations (or add
 * an in-memory/web one) without touching services, stores, hooks, or UI.
 *
 * All methods speak **domain types** (`MessageWithMeta`,
 * `RoomWithLastMessage`, …) — row ↔ domain mapping is an implementation
 * detail that must never leak upward.
 *
 * Consumed since Phase 3 by `cacheService` (hydration + write-through) —
 * still never directly by stores, hooks, or UI.
 */

export interface MessageRepository {
  /** Insert-or-replace by message id (idempotent batch write). */
  upsertMany(messages: MessageWithMeta[]): Promise<void>;
  /**
   * Replace the newest cached window with a fresh page-1 result: drops
   * cached rows at/after the batch's oldest created_at (so server-side
   * deletions in that range don't linger), then upserts the batch. An
   * empty batch means the room has no messages left → clears its cache.
   */
  replaceNewestWindow(
    roomId: string,
    messages: MessageWithMeta[]
  ): Promise<void>;
  /**
   * Newest-first page for one room (matches chatStore ordering).
   * `before` = created_at cursor, same semantics as messageService.getMessages.
   */
  getPageByRoom(
    roomId: string,
    limit: number,
    before?: string
  ): Promise<MessageWithMeta[]>;
  /**
   * A window centered on a message time (Phase 9 §3.3): up to `radius` rows
   * at-or-before `around` (includes the anchor) plus up to `radius` rows after
   * it, merged newest-first (chatStore ordering). Pure read — lets scroll
   * restore / search-jump bring a deep target into the resident window without
   * paging one call at a time. [] when the room isn't cached.
   */
  getWindowAround(
    roomId: string,
    around: string,
    radius: number
  ): Promise<MessageWithMeta[]>;
  deleteById(messageId: string): Promise<void>;
  deleteByRoom(roomId: string): Promise<void>;
  /** Keep only the newest `keep` rows of a room (cache pruning). */
  pruneRoom(roomId: string, keep: number): Promise<void>;
  clear(): Promise<void>;
}

export interface RoomRepository {
  /** Insert-or-replace the room-list payloads (get_user_rooms shape). */
  upsertMany(rooms: RoomWithLastMessage[]): Promise<void>;
  /**
   * Replace the entire cached list with a fresh get_user_rooms result
   * (rooms the user left must not linger in the cache).
   */
  replaceAll(rooms: RoomWithLastMessage[]): Promise<void>;
  /** All cached rooms, most recent activity first (room-list order). */
  getAll(): Promise<RoomWithLastMessage[]>;
  deleteById(roomId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ParticipantRepository {
  /** Replace a room's full participant set (mirrors setRoomParticipants). */
  replaceForRoom(
    roomId: string,
    participants: RoomParticipantWithProfile[]
  ): Promise<void>;
  getByRoom(roomId: string): Promise<RoomParticipantWithProfile[]>;
  deleteByRoom(roomId: string): Promise<void>;
  clear(): Promise<void>;
}

export interface AttachmentRepository {
  /** Replace a message's attachment rows (album order preserved). */
  replaceForMessage(
    messageId: string,
    attachments: MessageAttachment[]
  ): Promise<void>;
  getByMessage(messageId: string): Promise<MessageAttachment[]>;
  deleteByMessage(messageId: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Incremental-sync cursors (Phase 4). Stores one high-water-mark timestamp
 * per scope; knows nothing about deltas or merging — that logic lives above
 * (syncService) and in the pure merge helper (./merge.ts, Invariant #3).
 */
export interface SyncStateRepository {
  get(scopeId: string): Promise<SyncState | null>;
  /**
   * Upsert a scope's cursor. `last_synced_at` advances forward-only
   * (max of stored vs incoming) so an out-of-order batch never regresses it.
   */
  set(scopeId: string, patch: Partial<Omit<SyncState, "scope_id">>): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Durable outbox queue (Phase 5A, design §10.1, Invariant #3). Owns the
 * queue's synchronization state: the FIFO read order, atomic state
 * transitions, the monotonic per-room `created_at` guard, and dedup-by-id
 * storage. It knows the queue — NOT networks, timers, or retry policy (that
 * is `outboxService`), mirroring the Phase-4 mergeMessageWindow/syncService
 * split. All mapping is row↔domain; the pending message itself lives in the
 * `messages` table (status='pending'|'failed'), the outbox row is the index.
 */
export interface OutboxRepository {
  /** Upsert the message row (status='pending') + insert its outbox row, one txn. */
  enqueue(message: MessageWithMeta, createdAt: string): Promise<void>;
  /**
   * Every outbox row (pending + failed), JOINed to its message, FIFO by
   * created_at. The single enumeration for both drain and resume(): the worker
   * evaluates it head-first per room so the due-check preserves §6.2 FIFO — a
   * row-level "due" filter cannot (design §3.2).
   */
  listAll(): Promise<OutboxItem[]>;
  /** ACK: message.status=sent (+ adopt server fields) + delete outbox row, one txn. */
  markSent(id: string, serverRow: MessageWithMeta): Promise<void>;
  /** Park a message as FAILED (message.status=failed + outbox.state=failed). */
  markFailed(id: string, error: string, permanent: boolean): Promise<void>;
  /** Transient retry: bump attempts + persist next_attempt_at (stays pending). */
  reschedule(
    id: string,
    attempts: number,
    nextAttemptAt: string,
    error: string
  ): Promise<void>;
  /** Discard: delete the message row + its outbox row, one txn. */
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Media upload queue (Phase 7A §3.4, Invariant M2). Owns persisted queue
 * state and the atomic transitions — including the completion-gate
 * transaction, because it spans `messages` + `outbox` + `upload_queue` rows
 * and row↔domain mapping lives in sqlite.ts (the same reason OutboxRepository
 * is co-located there). It does NOT know about networks, timers, compression,
 * or retry policy — that is `mediaService`. Fully independent of the outbox
 * queue: the only touch point is `completeMessage` inserting the outbox row
 * through the same file-private SQL the OutboxRepository uses.
 */
export interface UploadQueueRepository {
  /** Upsert the message row (status='pending') + N upload_queue inserts, one txn. */
  enqueueMessageWithUploads(
    message: MessageWithMeta,
    tasks: UploadTask[]
  ): Promise<void>;
  /**
   * All 'queued' | 'uploading' rows, global FIFO (created_at, position).
   * 'uploading' rows are stale after a crash — resume() reverts them first.
   */
  listActive(): Promise<UploadTask[]>;
  /** Every task of one message, in position order (gate rewrite, discard). */
  listForMessage(messageId: string): Promise<UploadTask[]>;
  /**
   * Message ids whose tasks are ALL 'uploaded' but whose message row is
   * still 'pending' with no outbox row — the crashed-between-upload-and-gate
   * window (§11.2 M5); resume() re-runs the completion gate for each.
   */
  listCompletableMessageIds(): Promise<string[]>;
  /**
   * Message ids that still hold upload_queue rows but whose message row is
   * already status='sent' (post-ACK) — the lazy SENT sweep (§2.1 rule 7)
   * clears these rows + their staging dirs.
   */
  listSentMessageIds(): Promise<string[]>;
  /** Crash recovery: 'uploading' → 'queued' (idempotent PUT makes this safe). */
  revertUploadingToQueued(): Promise<void>;
  markUploading(id: string): Promise<void>;
  markUploaded(id: string, remotePath: string, remoteUrl: string): Promise<void>;
  /** Transient retry: bump attempts + persist next_attempt_at (stays queued). */
  reschedule(
    id: string,
    attempts: number,
    nextAttemptAt: string,
    error: string
  ): Promise<void>;
  /** Permanent / exhausted → task parked + owning message.status='failed', one txn. */
  markFailed(id: string, error: string): Promise<void>;
  /** Manual retry: failed tasks → queued, attempts=0 + message.status='pending', one txn. */
  resetForRetry(messageId: string): Promise<void>;
  getMessageCompletion(
    messageId: string
  ): Promise<{ total: number; uploaded: number; failed: number }>;
  /**
   * Completion gate (§2.1 rule 5): rewrite messages.attachments/media_url to
   * remote URLs + INSERT the outbox row (using the message's already-stamped
   * created_at — no restamp), ONE txn. Idempotent via INSERT OR REPLACE.
   */
  completeMessage(
    messageId: string,
    rewrittenAttachments: MessageAttachment[]
  ): Promise<void>;
  /** Discard: queue rows + message row, one txn. */
  removeForMessage(messageId: string): Promise<void>;
  /** Post-ACK cleanup (§2.1 rule 7): queue rows only — the message stays. */
  clearSent(messageId: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Local search index (Phase 8A/8B §4). Sole owner of the `search_index`
 * projection + the `message_fts` FTS5 vtable — a DERIVED, droppable cache of
 * the searchable `messages` corpus, never a source of truth (§18). It knows
 * SQL/FTS only: NOT networks, ranking-weight policy, debounce, or the
 * MessageSearchResult shape (that is `searchService`). Every write is
 * idempotent and rebuildable from `messages` (§16). No existing repository
 * gains, loses, or shares responsibility — this is added beside them exactly
 * as Phase 7 added `UploadQueueRepository`.
 */
export interface SearchRepository {
  /** Idempotent upsert of N projected docs (INSERT OR REPLACE by message_id), one txn. */
  apply(docs: SearchDoc[]): Promise<void>;
  /**
   * Page-1 window reconcile (mirrors MessageRepository.replaceNewestWindow):
   * drop indexed rows of the room at/after the batch's oldest created_at (so
   * server-side deletions in that range don't linger in the index), then upsert
   * the batch — one txn. Empty batch clears the room's index rows.
   */
  applyWindow(roomId: string, docs: SearchDoc[]): Promise<void>;
  /** Remove a message from the index (delete / recall / soft-delete). No-op if absent. */
  removeByMessage(messageId: string): Promise<void>;
  /** Drop a whole room's index rows (leave room / cache eviction). */
  removeByRoom(roomId: string): Promise<void>;
  /** Keep only the newest `keep` indexed rows of a room (lockstep with cache prune). */
  pruneRoom(roomId: string, keep: number): Promise<void>;
  /** Drop index rows whose backing `messages` row is gone (I-S2 orphan sweep). */
  removeOrphans(): Promise<void>;
  /**
   * Ranked local query. Returns hydrated hits (ids + display fields JOINed from
   * `messages` + blended score + FTS snippet/highlight) and which path served
   * them. `kind` maps to the same lane predicate as the server RPC.
   */
  search(params: SearchQuery): Promise<SearchResultSet>;
  /**
   * Searchable cached messages (deleted_at IS NULL AND type<>'system') missing
   * from the index, as domain rows ready to re-index, plus the total drift
   * count (§16.2 boot repair / I-S1 coverage). `limit` bounds the returned batch.
   */
  coverageAudit(
    limit: number
  ): Promise<{ pending: MessageWithMeta[]; drift: number }>;
  /** Current indexed row count (I-S3 bound gauge). */
  count(): Promise<number>;
  /** DROP + CREATE the projection (triggers/FTS follow), then return (caller refills). §16.4. */
  rebuild(): Promise<void>;
  clear(): Promise<void>;
}

/** Everything the application layer can reach — one bundle per connection. */
export interface Repositories {
  messages: MessageRepository;
  rooms: RoomRepository;
  participants: ParticipantRepository;
  attachments: AttachmentRepository;
  syncState: SyncStateRepository;
  outbox: OutboxRepository;
  uploadQueue: UploadQueueRepository;
  search: SearchRepository;
}

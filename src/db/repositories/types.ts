import type {
  MessageAttachment,
  MessageWithMeta,
  RoomParticipantWithProfile,
  RoomWithLastMessage,
  SyncState,
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

/** Everything the application layer can reach — one bundle per connection. */
export interface Repositories {
  messages: MessageRepository;
  rooms: RoomRepository;
  participants: ParticipantRepository;
  attachments: AttachmentRepository;
  syncState: SyncStateRepository;
}

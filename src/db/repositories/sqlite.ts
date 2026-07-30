import type { SQLiteDatabase } from "expo-sqlite";
import type {
  Message,
  MessageAttachment,
  MessageSearchKind,
  MessageWithMeta,
  OutboxItem,
  RoomParticipantWithProfile,
  RoomWithLastMessage,
  SearchDoc,
  SearchHit,
  SyncState,
  UploadTask,
} from "@/src/types";
import type {
  AttachmentRepository,
  MessageRepository,
  OutboxRepository,
  ParticipantRepository,
  Repositories,
  RoomRepository,
  SearchRepository,
  SyncStateRepository,
  UploadQueueRepository,
} from "./types";
import { ensureSearchFtsSchema } from "../migrations";

/**
 * SQLite implementations of the repository contracts (see ./types.ts).
 *
 * Row ↔ domain mapping lives entirely in this file: booleans are stored as
 * 0/1, JSON columns as serialized strings. Nothing outside this file may
 * build SQL against the cache tables.
 *
 * `import type` only for expo-sqlite — no runtime dependency, so bundling
 * this file on web is harmless (it is simply never constructed there).
 */

// ---------------------------------------------------------------------------
// messages
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string | null;
  type: string | null;
  media_url: string | null;
  reply_to: string | null;
  thread_id: string | null;
  has_link: number | null;
  is_edited: number | null;
  pinned_at: string | null;
  pinned_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  attachments: string | null;
  metadata: string | null;
  reactions: string | null;
  poll_votes: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function parseJson<T>(value: string | null): T | null {
  if (value == null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null; // corrupt cache cell degrades to "no data", never throws
  }
}

function toMessageRowParams(m: MessageWithMeta) {
  return [
    m.id,
    m.room_id,
    m.sender_id,
    m.content,
    m.type,
    m.media_url,
    m.reply_to,
    m.thread_id,
    m.has_link == null ? null : m.has_link ? 1 : 0,
    m.is_edited == null ? null : m.is_edited ? 1 : 0,
    m.pinned_at,
    m.pinned_by,
    m.deleted_at,
    m.deleted_by,
    m.attachments == null ? null : JSON.stringify(m.attachments),
    m.metadata == null ? null : JSON.stringify(m.metadata),
    m.message_reactions == null ? null : JSON.stringify(m.message_reactions),
    m.poll_votes == null ? null : JSON.stringify(m.poll_votes),
    // Outbox send state (Phase 5A): only pending/failed rows carry a non-'sent'
    // status; every normal/ingested row persists as 'sent' (schema default).
    m.outbox_status ?? "sent",
    m.created_at,
    m.updated_at,
  ];
}

function rowToMessage(row: MessageRow): MessageWithMeta {
  return {
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    content: row.content,
    type: row.type,
    media_url: row.media_url,
    reply_to: row.reply_to,
    thread_id: row.thread_id,
    has_link: row.has_link == null ? null : row.has_link === 1,
    is_edited: row.is_edited == null ? null : row.is_edited === 1,
    pinned_at: row.pinned_at,
    pinned_by: row.pinned_by,
    deleted_at: row.deleted_at,
    deleted_by: row.deleted_by,
    attachments: parseJson<Message["attachments"]>(row.attachments),
    metadata: parseJson<Message["metadata"]>(row.metadata),
    message_reactions:
      parseJson<MessageWithMeta["message_reactions"]>(row.reactions) ??
      undefined,
    poll_votes:
      parseJson<MessageWithMeta["poll_votes"]>(row.poll_votes) ?? undefined,
    // Only pending/failed hydrate a send-state annotation; 'sent' (and any
    // legacy null) render as a normal message (Phase 5A §9.1).
    outbox_status:
      row.status === "pending" || row.status === "failed"
        ? row.status
        : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const UPSERT_MESSAGE_SQL = `
  INSERT OR REPLACE INTO messages (
    id, room_id, sender_id, content, type, media_url, reply_to, thread_id,
    has_link, is_edited, pinned_at, pinned_by, deleted_at, deleted_by,
    attachments, metadata, reactions, poll_votes, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function createMessageRepository(db: SQLiteDatabase): MessageRepository {
  async function upsertInTxn(
    txn: Parameters<Parameters<SQLiteDatabase["withExclusiveTransactionAsync"]>[0]>[0],
    messages: MessageWithMeta[]
  ) {
    const stmt = await txn.prepareAsync(UPSERT_MESSAGE_SQL);
    try {
      for (const m of messages) {
        await stmt.executeAsync(toMessageRowParams(m));
      }
    } finally {
      await stmt.finalizeAsync();
    }
  }

  return {
    async upsertMany(messages) {
      if (messages.length === 0) return;
      await db.withExclusiveTransactionAsync(async (txn) => {
        await upsertInTxn(txn, messages);
      });
    },

    async replaceNewestWindow(roomId, messages) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        if (messages.length === 0) {
          // Fresh page 1 is empty → the room has no visible history left
          await txn.runAsync("DELETE FROM messages WHERE room_id = ?", [
            roomId,
          ]);
          return;
        }
        // Drop cached rows in the window's time range so messages deleted
        // server-side while we were away don't survive the refresh
        const oldest = messages.reduce<string | null>(
          (min, m) =>
            m.created_at != null && (min == null || m.created_at < min)
              ? m.created_at
              : min,
          null
        );
        if (oldest != null) {
          await txn.runAsync(
            "DELETE FROM messages WHERE room_id = ? AND created_at >= ?",
            [roomId, oldest]
          );
        }
        await upsertInTxn(txn, messages);
      });
    },

    async getPageByRoom(roomId, limit, before) {
      const rows = before
        ? await db.getAllAsync<MessageRow>(
            `SELECT * FROM messages
              WHERE room_id = ? AND created_at < ?
              ORDER BY created_at DESC LIMIT ?`,
            [roomId, before, limit]
          )
        : await db.getAllAsync<MessageRow>(
            `SELECT * FROM messages
              WHERE room_id = ?
              ORDER BY created_at DESC LIMIT ?`,
            [roomId, limit]
          );
      return rows.map(rowToMessage);
    },

    async deleteById(messageId) {
      await db.runAsync("DELETE FROM messages WHERE id = ?", [messageId]);
    },

    async deleteByRoom(roomId) {
      await db.runAsync("DELETE FROM messages WHERE room_id = ?", [roomId]);
    },

    async pruneRoom(roomId, keep) {
      await db.runAsync(
        `DELETE FROM messages
          WHERE room_id = ? AND id NOT IN (
            SELECT id FROM messages
             WHERE room_id = ?
             ORDER BY created_at DESC LIMIT ?
          )`,
        [roomId, roomId, keep]
      );
    },

    async clear() {
      await db.runAsync("DELETE FROM messages");
    },
  };
}

// ---------------------------------------------------------------------------
// rooms (RoomWithLastMessage payload as JSON)
// ---------------------------------------------------------------------------

interface RoomRow {
  room_id: string;
  payload: string;
}

function createRoomRepository(db: SQLiteDatabase): RoomRepository {
  async function upsertInTxn(
    txn: Parameters<Parameters<SQLiteDatabase["withExclusiveTransactionAsync"]>[0]>[0],
    rooms: RoomWithLastMessage[]
  ) {
    const stmt = await txn.prepareAsync(
      `INSERT OR REPLACE INTO rooms (room_id, payload, last_message_at, updated_at)
       VALUES (?, ?, ?, ?)`
    );
    try {
      const now = new Date().toISOString();
      for (const room of rooms) {
        await stmt.executeAsync([
          room.room_id,
          JSON.stringify(room),
          room.last_message_at,
          now,
        ]);
      }
    } finally {
      await stmt.finalizeAsync();
    }
  }

  return {
    async upsertMany(rooms) {
      if (rooms.length === 0) return;
      await db.withExclusiveTransactionAsync(async (txn) => {
        await upsertInTxn(txn, rooms);
      });
    },

    async replaceAll(rooms) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        // Full-list snapshot: rooms the user left disappear from the cache
        await txn.runAsync("DELETE FROM rooms");
        await upsertInTxn(txn, rooms);
      });
    },

    async getAll() {
      const rows = await db.getAllAsync<RoomRow>(
        // NULLs (rooms without messages) sort last, matching get_user_rooms
        `SELECT room_id, payload FROM rooms
          ORDER BY last_message_at IS NULL, last_message_at DESC`
      );
      return rows
        .map((r) => parseJson<RoomWithLastMessage>(r.payload))
        .filter((r): r is RoomWithLastMessage => r !== null);
    },

    async deleteById(roomId) {
      await db.runAsync("DELETE FROM rooms WHERE room_id = ?", [roomId]);
    },

    async clear() {
      await db.runAsync("DELETE FROM rooms");
    },
  };
}

// ---------------------------------------------------------------------------
// room_participants (joined profile as JSON)
// ---------------------------------------------------------------------------

interface ParticipantRow {
  id: string;
  room_id: string;
  user_id: string;
  role: string | null;
  joined_at: string | null;
  last_read_at: string | null;
  bookmarked_at: string | null;
  profile: string | null;
}

function createParticipantRepository(
  db: SQLiteDatabase
): ParticipantRepository {
  return {
    async replaceForRoom(roomId, participants) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          "DELETE FROM room_participants WHERE room_id = ?",
          [roomId]
        );
        const stmt = await txn.prepareAsync(
          `INSERT OR REPLACE INTO room_participants
             (id, room_id, user_id, role, joined_at, last_read_at,
              bookmarked_at, profile, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        try {
          const now = new Date().toISOString();
          for (const p of participants) {
            await stmt.executeAsync([
              p.id,
              p.room_id,
              p.user_id,
              p.role,
              p.joined_at,
              p.last_read_at,
              p.bookmarked_at,
              p.profiles == null ? null : JSON.stringify(p.profiles),
              now,
            ]);
          }
        } finally {
          await stmt.finalizeAsync();
        }
      });
    },

    async getByRoom(roomId) {
      const rows = await db.getAllAsync<ParticipantRow>(
        "SELECT * FROM room_participants WHERE room_id = ?",
        [roomId]
      );
      return rows.map((row) => ({
        id: row.id,
        room_id: row.room_id,
        user_id: row.user_id,
        role: row.role,
        joined_at: row.joined_at,
        last_read_at: row.last_read_at,
        bookmarked_at: row.bookmarked_at,
        profiles: parseJson<RoomParticipantWithProfile["profiles"]>(
          row.profile
        ),
      }));
    },

    async deleteByRoom(roomId) {
      await db.runAsync(
        "DELETE FROM room_participants WHERE room_id = ?",
        [roomId]
      );
    },

    async clear() {
      await db.runAsync("DELETE FROM room_participants");
    },
  };
}

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------

interface AttachmentRow {
  url: string;
  width: number | null;
  height: number | null;
}

function createAttachmentRepository(
  db: SQLiteDatabase
): AttachmentRepository {
  return {
    async replaceForMessage(messageId, attachments) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          "DELETE FROM attachments WHERE message_id = ?",
          [messageId]
        );
        const stmt = await txn.prepareAsync(
          `INSERT INTO attachments (message_id, position, url, width, height)
           VALUES (?, ?, ?, ?, ?)`
        );
        try {
          for (let i = 0; i < attachments.length; i++) {
            const a = attachments[i];
            await stmt.executeAsync([
              messageId,
              i,
              a.url,
              a.width ?? null,
              a.height ?? null,
            ]);
          }
        } finally {
          await stmt.finalizeAsync();
        }
      });
    },

    async getByMessage(messageId) {
      const rows = await db.getAllAsync<AttachmentRow>(
        `SELECT url, width, height FROM attachments
          WHERE message_id = ? ORDER BY position ASC`,
        [messageId]
      );
      return rows.map(
        (row): MessageAttachment => ({
          url: row.url,
          width: row.width ?? undefined,
          height: row.height ?? undefined,
        })
      );
    },

    async deleteByMessage(messageId) {
      await db.runAsync("DELETE FROM attachments WHERE message_id = ?", [
        messageId,
      ]);
    },

    async clear() {
      await db.runAsync("DELETE FROM attachments");
    },
  };
}

// ---------------------------------------------------------------------------
// sync_state (Phase 4 — incremental-sync cursors)
// ---------------------------------------------------------------------------

interface SyncStateRow {
  scope_id: string;
  last_synced_at: string | null;
  has_full_history: number | null;
  stale: number | null;
}

function rowToSyncState(row: SyncStateRow): SyncState {
  return {
    scope_id: row.scope_id,
    last_synced_at: row.last_synced_at,
    has_full_history: row.has_full_history === 1,
    stale: row.stale === 1,
  };
}

function createSyncStateRepository(db: SQLiteDatabase): SyncStateRepository {
  return {
    async get(scopeId) {
      const row = await db.getFirstAsync<SyncStateRow>(
        "SELECT scope_id, last_synced_at, has_full_history, stale FROM sync_state WHERE scope_id = ?",
        [scopeId]
      );
      return row ? rowToSyncState(row) : null;
    },

    // Read-modify-write in one transaction: partial patches keep untouched
    // fields, and last_synced_at only ever moves forward (ISO-8601 strings
    // sort chronologically, so a lexical `>` is a chronological compare).
    async set(scopeId, patch) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        const row = await txn.getFirstAsync<SyncStateRow>(
          "SELECT scope_id, last_synced_at, has_full_history, stale FROM sync_state WHERE scope_id = ?",
          [scopeId]
        );
        const current = row ? rowToSyncState(row) : null;

        let lastSyncedAt = current?.last_synced_at ?? null;
        if (patch.last_synced_at != null) {
          lastSyncedAt =
            lastSyncedAt == null || patch.last_synced_at > lastSyncedAt
              ? patch.last_synced_at
              : lastSyncedAt;
        }
        const hasFullHistory =
          patch.has_full_history ?? current?.has_full_history ?? false;
        const stale = patch.stale ?? current?.stale ?? false;

        await txn.runAsync(
          `INSERT OR REPLACE INTO sync_state
             (scope_id, last_synced_at, has_full_history, stale, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [
            scopeId,
            lastSyncedAt,
            hasFullHistory ? 1 : 0,
            stale ? 1 : 0,
            new Date().toISOString(),
          ]
        );
      });
    },

    async clear() {
      await db.runAsync("DELETE FROM sync_state");
    },
  };
}

// ---------------------------------------------------------------------------
// outbox (Phase 5A — durable send queue; the message row IS the payload)
// ---------------------------------------------------------------------------

/**
 * Monotonic per-room authoring clock (design §6.3): guards against a backward
 * device-clock jump inverting two sends' created_at. The effective stamp is
 * max(incoming, lastEnqueued + 1ms) per room, so intra-room FIFO stays stable
 * regardless of wall-clock jitter. In-memory only (persisted created_at also
 * anchors order); it resets on relaunch, which is harmless — a fresh process
 * has no in-flight sends to keep monotonic against.
 */
const lastEnqueuedByRoom = new Map<string, number>();

function monotonicCreatedAt(roomId: string, createdAt: string): string {
  const incoming = new Date(createdAt).getTime();
  const last = lastEnqueuedByRoom.get(roomId);
  const effective = last != null && incoming <= last ? last + 1 : incoming;
  lastEnqueuedByRoom.set(roomId, effective);
  return new Date(effective).toISOString();
}

// The due/all query returns the whole message row (the send payload) plus the
// three outbox bookkeeping fields the worker needs, aliased to avoid colliding
// with the message's own id/room_id/created_at/updated_at columns.
interface OutboxJoinRow extends MessageRow {
  o_attempts: number;
  o_next_attempt_at: string | null;
  o_state: string;
}

function rowToOutboxItem(row: OutboxJoinRow): OutboxItem {
  return {
    message: rowToMessage(row),
    attempts: row.o_attempts,
    next_attempt_at: row.o_next_attempt_at,
    state: row.o_state === "failed" ? "failed" : "pending",
  };
}

const OUTBOX_SELECT_SQL = `
  SELECT m.*, o.attempts AS o_attempts,
         o.next_attempt_at AS o_next_attempt_at, o.state AS o_state
    FROM outbox o JOIN messages m ON m.id = o.id`;

function createOutboxRepository(db: SQLiteDatabase): OutboxRepository {
  return {
    async enqueue(message, createdAt) {
      const stampedAt = monotonicCreatedAt(message.room_id, createdAt);
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        // The pending message is a real messages row (status='pending') so it
        // hydrates & renders after restart with zero special-casing (§3.1).
        await txn.runAsync(
          UPSERT_MESSAGE_SQL,
          toMessageRowParams({
            ...message,
            created_at: stampedAt,
            outbox_status: "pending",
          })
        );
        // The outbox row is the thin queue index (bookkeeping only, §3.1).
        await txn.runAsync(
          `INSERT OR REPLACE INTO outbox
             (id, room_id, attempts, next_attempt_at, last_error, state, created_at, updated_at)
           VALUES (?, ?, 0, NULL, NULL, 'pending', ?, ?)`,
          [message.id, message.room_id, stampedAt, now]
        );
      });
    },

    // The single ordered enumeration for both drain and resume() (pending +
    // failed). The worker evaluates this head-first per room (design §3.2) so
    // the due-check preserves §6.2 FIFO — a row-level "due" filter would let a
    // follower jump ahead of a transiently-rescheduled head.
    async listAll() {
      const rows = await db.getAllAsync<OutboxJoinRow>(
        `${OUTBOX_SELECT_SQL} ORDER BY o.created_at ASC`
      );
      return rows.map(rowToOutboxItem);
    },

    async markSent(id, serverRow) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        // Adopt the server row: outbox_status undefined maps to status='sent',
        // so a sent message is indistinguishable from a normally-received one.
        await txn.runAsync(
          UPSERT_MESSAGE_SQL,
          toMessageRowParams({ ...serverRow, outbox_status: undefined })
        );
        await txn.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
      });
    },

    // Park terminally as FAILED. Both a permanent error and an attempts-cap
    // exhaustion land here; the repository stores the same parked state either
    // way, so `_permanent` is not needed for the write (kept for interface parity).
    async markFailed(id, error, _permanent) {
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync("UPDATE messages SET status = 'failed' WHERE id = ?", [
          id,
        ]);
        await txn.runAsync(
          `UPDATE outbox SET state = 'failed', last_error = ?, updated_at = ?
            WHERE id = ?`,
          [error, now, id]
        );
      });
    },

    async reschedule(id, attempts, nextAttemptAt, error) {
      await db.runAsync(
        `UPDATE outbox
            SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
          WHERE id = ?`,
        [attempts, nextAttemptAt, error, new Date().toISOString(), id]
      );
    },

    async remove(id) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync("DELETE FROM messages WHERE id = ?", [id]);
        await txn.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
      });
    },

    async clear() {
      await db.runAsync("DELETE FROM outbox");
    },
  };
}

// ---------------------------------------------------------------------------
// upload_queue (Phase 7A/7B — media upload work list; message row IS the payload)
// ---------------------------------------------------------------------------

interface UploadQueueRow {
  id: string;
  message_id: string;
  room_id: string;
  position: number;
  kind: string;
  local_uri: string;
  mime: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumb: string | null;
  remote_path: string | null;
  remote_url: string | null;
  state: string;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string | null;
}

function rowToUploadTask(row: UploadQueueRow): UploadTask {
  return {
    id: row.id,
    message_id: row.message_id,
    room_id: row.room_id,
    position: row.position,
    kind:
      row.kind === "video" || row.kind === "file" ? row.kind : "image",
    local_uri: row.local_uri,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    duration_ms: row.duration_ms,
    thumb: row.thumb,
    remote_path: row.remote_path,
    remote_url: row.remote_url,
    state:
      row.state === "uploading" ||
      row.state === "uploaded" ||
      row.state === "failed"
        ? row.state
        : "queued",
    attempts: row.attempts,
    next_attempt_at: row.next_attempt_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createUploadQueueRepository(db: SQLiteDatabase): UploadQueueRepository {
  return {
    async enqueueMessageWithUploads(message, tasks) {
      // Same monotonic per-room stamp as the outbox enqueue — the created_at
      // written here is final: completeMessage reuses it (no restamp), so the
      // bubble never re-sorts between authoring and delivery (§2.1 rule 3).
      const stampedAt = monotonicCreatedAt(
        message.room_id,
        message.created_at ?? new Date().toISOString()
      );
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        // The media message is a real messages row (status='pending', staged
        // local URIs in attachments) — hydrates & renders after restart with
        // zero special-casing, exactly like a 5A pending text (§3.1).
        await txn.runAsync(
          UPSERT_MESSAGE_SQL,
          toMessageRowParams({
            ...message,
            created_at: stampedAt,
            outbox_status: "pending",
          })
        );
        const stmt = await txn.prepareAsync(
          `INSERT OR REPLACE INTO upload_queue
             (id, message_id, room_id, position, kind, local_uri, mime, bytes,
              width, height, duration_ms, thumb, remote_path, remote_url,
              state, attempts, next_attempt_at, last_error, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL,
                   'queued', 0, NULL, NULL, ?, ?)`
        );
        try {
          for (const t of tasks) {
            await stmt.executeAsync([
              t.id,
              message.id,
              message.room_id,
              t.position,
              t.kind,
              t.local_uri,
              t.mime,
              t.bytes,
              t.width,
              t.height,
              t.duration_ms,
              t.thumb,
              stampedAt, // authoring instant = global FIFO key (§3.3)
              now,
            ]);
          }
        } finally {
          await stmt.finalizeAsync();
        }
      });
    },

    // Global FIFO by authoring time, attachments in order — no per-room
    // seriality (uploads target distinct objects; order is fairness only).
    async listActive() {
      const rows = await db.getAllAsync<UploadQueueRow>(
        `SELECT * FROM upload_queue
          WHERE state IN ('queued','uploading')
          ORDER BY created_at ASC, position ASC`
      );
      return rows.map(rowToUploadTask);
    },

    async listForMessage(messageId) {
      const rows = await db.getAllAsync<UploadQueueRow>(
        `SELECT * FROM upload_queue
          WHERE message_id = ? ORDER BY position ASC`,
        [messageId]
      );
      return rows.map(rowToUploadTask);
    },

    // Crashed-between-upload-and-gate window (§11.2 M5): every task uploaded,
    // message still 'pending', no outbox row yet — the gate must re-run.
    async listCompletableMessageIds() {
      const rows = await db.getAllAsync<{ message_id: string }>(
        `SELECT u.message_id FROM upload_queue u
           JOIN messages m ON m.id = u.message_id AND m.status = 'pending'
           LEFT JOIN outbox o ON o.id = u.message_id
          WHERE o.id IS NULL
          GROUP BY u.message_id
         HAVING SUM(CASE WHEN u.state = 'uploaded' THEN 1 ELSE 0 END) = COUNT(*)`
      );
      return rows.map((r) => r.message_id);
    },

    // Lazy SENT sweep (§2.1 rule 7): queue rows whose message was ACKed
    // (status='sent') — or whose message row is gone entirely (recalled /
    // pruned) — are dead weight; the caller clears them + their staging dirs.
    async listSentMessageIds() {
      const rows = await db.getAllAsync<{ message_id: string }>(
        `SELECT DISTINCT u.message_id FROM upload_queue u
           LEFT JOIN messages m ON m.id = u.message_id
          WHERE m.id IS NULL OR m.status = 'sent'`
      );
      return rows.map((r) => r.message_id);
    },

    // Crash recovery (§11.2 M4): an 'uploading' row after relaunch is stale by
    // definition (no in-flight request survives the process). Reverting to
    // 'queued' is safe because the PUT is idempotent by object path (§4.3).
    async revertUploadingToQueued() {
      await db.runAsync(
        `UPDATE upload_queue SET state = 'queued', updated_at = ?
          WHERE state = 'uploading'`,
        [new Date().toISOString()]
      );
    },

    async markUploading(id) {
      await db.runAsync(
        `UPDATE upload_queue SET state = 'uploading', updated_at = ?
          WHERE id = ?`,
        [new Date().toISOString(), id]
      );
    },

    async markUploaded(id, remotePath, remoteUrl) {
      await db.runAsync(
        `UPDATE upload_queue
            SET state = 'uploaded', remote_path = ?, remote_url = ?,
                last_error = NULL, updated_at = ?
          WHERE id = ?`,
        [remotePath, remoteUrl, new Date().toISOString(), id]
      );
    },

    // Transient retry: back to 'queued' with a future due time; the persisted
    // attempts/schedule survive restart (same contract as outbox.reschedule).
    async reschedule(id, attempts, nextAttemptAt, error) {
      await db.runAsync(
        `UPDATE upload_queue
            SET state = 'queued', attempts = ?, next_attempt_at = ?,
                last_error = ?, updated_at = ?
          WHERE id = ?`,
        [attempts, nextAttemptAt, error, new Date().toISOString(), id]
      );
    },

    // Message-level parking (§2.1 rule 6): one permanently-failed task parks
    // the whole message — sibling tasks stay as-is ('uploaded' work is kept;
    // 'queued' siblings are skipped by the worker once the message is parked).
    async markFailed(id, error) {
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          `UPDATE upload_queue
              SET state = 'failed', last_error = ?, updated_at = ?
            WHERE id = ?`,
          [error, now, id]
        );
        await txn.runAsync(
          `UPDATE messages SET status = 'failed'
            WHERE id = (SELECT message_id FROM upload_queue WHERE id = ?)`,
          [id]
        );
      });
    },

    // Manual retry (§10.3): only failed tasks reset — already-uploaded
    // siblings keep their remote objects (the PUT was idempotent anyway).
    async resetForRetry(messageId) {
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          `UPDATE upload_queue
              SET state = 'queued', attempts = 0, next_attempt_at = NULL,
                  last_error = NULL, updated_at = ?
            WHERE message_id = ? AND state = 'failed'`,
          [now, messageId]
        );
        await txn.runAsync(
          "UPDATE messages SET status = 'pending' WHERE id = ?",
          [messageId]
        );
      });
    },

    async getMessageCompletion(messageId) {
      const row = await db.getFirstAsync<{
        total: number;
        uploaded: number;
        failed: number;
      }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN state = 'uploaded' THEN 1 ELSE 0 END) AS uploaded,
                SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed
           FROM upload_queue WHERE message_id = ?`,
        [messageId]
      );
      return {
        total: row?.total ?? 0,
        uploaded: row?.uploaded ?? 0,
        failed: row?.failed ?? 0,
      };
    },

    // Completion gate (§2.1 rule 5, §4.4): local→remote rewrite + outbox
    // insert in ONE txn — delivery can never begin with local URIs, and a
    // crash leaves either "still uploading" or "fully handed off", nothing
    // between. The outbox row reuses the message's already-stamped created_at
    // so the queue position matches the authoring instant (no restamp).
    async completeMessage(messageId, rewrittenAttachments) {
      const now = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        const msg = await txn.getFirstAsync<{
          room_id: string;
          created_at: string | null;
          attachments: string | null;
        }>(
          "SELECT room_id, created_at, attachments FROM messages WHERE id = ?",
          [messageId]
        );
        // Message recalled/pruned mid-upload — nothing to hand off; the
        // orphaned queue rows fall to the SENT/orphan sweep.
        if (!msg) return;
        // Merge per position over the staged JSON: the rewrite only swaps the
        // upload-derived fields (url, dims, thumb…); authoring-only fields
        // like a file's display `name` survive untouched.
        const existing =
          parseJson<MessageAttachment[]>(msg.attachments) ?? [];
        const merged = rewrittenAttachments.map((a, i) => ({
          ...existing[i],
          ...a,
        }));
        await txn.runAsync(
          `UPDATE messages SET attachments = ?, media_url = ? WHERE id = ?`,
          [JSON.stringify(merged), merged[0]?.url ?? null, messageId]
        );
        await txn.runAsync(
          `INSERT OR REPLACE INTO outbox
             (id, room_id, attempts, next_attempt_at, last_error, state, created_at, updated_at)
           VALUES (?, ?, 0, NULL, NULL, 'pending', ?, ?)`,
          [messageId, msg.room_id, msg.created_at ?? now, now]
        );
      });
    },

    async removeForMessage(messageId) {
      await db.withExclusiveTransactionAsync(async (txn) => {
        await txn.runAsync(
          "DELETE FROM upload_queue WHERE message_id = ?",
          [messageId]
        );
        await txn.runAsync("DELETE FROM messages WHERE id = ?", [messageId]);
      });
    },

    async clearSent(messageId) {
      await db.runAsync("DELETE FROM upload_queue WHERE message_id = ?", [
        messageId,
      ]);
    },

    async clear() {
      await db.runAsync("DELETE FROM upload_queue");
    },
  };
}

// ---------------------------------------------------------------------------
// search index (Phase 8A/8B) — the DERIVED FTS projection over `messages`
// ---------------------------------------------------------------------------

interface SearchHitRow {
  message_id: string;
  room_id: string;
  sender_id: string | null;
  type: string;
  created_at: string;
  content: string | null;
  media_url: string | null;
  attachments: string | null;
  score: number;
  snippet: string | null;
  highlight: string | null;
}

const UPSERT_SEARCH_SQL = `
  INSERT INTO search_index
    (message_id, room_id, sender_id, type, has_link, created_ms, created_at, text, media_text, indexed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(message_id) DO UPDATE SET
    room_id     = excluded.room_id,
    sender_id   = excluded.sender_id,
    type        = excluded.type,
    has_link    = excluded.has_link,
    created_ms  = excluded.created_ms,
    created_at  = excluded.created_at,
    text        = excluded.text,
    media_text  = excluded.media_text,
    indexed_at  = excluded.indexed_at`;

function searchDocParams(doc: SearchDoc, indexedAt: string) {
  return [
    doc.message_id,
    doc.room_id,
    doc.sender_id,
    doc.type,
    doc.has_link ? 1 : 0,
    doc.created_ms,
    doc.created_at,
    doc.text,
    doc.media_text,
    indexedAt,
  ];
}

function rowToSearchHit(row: SearchHitRow): SearchHit {
  return {
    message_id: row.message_id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    content: row.content,
    type: row.type,
    media_url: row.media_url,
    attachments: parseJson<Message["attachments"]>(row.attachments),
    created_at: row.created_at,
    score: row.score,
    snippet: row.snippet,
    highlight: row.highlight,
  };
}

// Lane → SQL predicate on the `si` (search_index) alias — identical visibility
// to the server search_messages RPC (design §11).
function lanePredicate(kind: MessageSearchKind): string {
  switch (kind) {
    case "image":
      return "si.type IN ('image','video')";
    case "file":
      return "si.type = 'file'";
    case "link":
      return "si.has_link = 1";
    case "message":
    default:
      return "si.type IN ('text','image','video','file')";
  }
}

// Whitelist-tokenize (fold case; keep letters/numbers only) — the FTS analogue
// of parameterization: raw operators (" * : AND NEAR) can never reach the
// MATCH grammar because only [\p{L}\p{N}] runs survive (design §5.2).
function searchTokens(query: string): string[] {
  return query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Escape LIKE metacharacters for the substring fallback (paired with ESCAPE '\\').
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Delimiters FTS5 highlight()/snippet() wrap matches in — control chars that
// never occur in chat text, so searchService can split them into offsets (§9).
const HL_OPEN = "\u0002";
const HL_CLOSE = "\u0003";

function createSearchRepository(db: SQLiteDatabase): SearchRepository {
  // Per-connection memo of FTS5 availability (design §16.5): the vtable is
  // created best-effort outside the migration chain, so a build without FTS5
  // simply has no `message_fts` table and every query takes the LIKE path.
  // Reset by rebuild(); re-probed lazily.
  let ftsAvailable: boolean | null = null;

  async function hasFts(): Promise<boolean> {
    if (ftsAvailable !== null) return ftsAvailable;
    try {
      const row = await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'"
      );
      ftsAvailable = (row?.n ?? 0) > 0;
    } catch {
      ftsAvailable = false;
    }
    return ftsAvailable;
  }

  async function upsertInTxn(
    txn: Parameters<Parameters<SQLiteDatabase["withExclusiveTransactionAsync"]>[0]>[0],
    docs: SearchDoc[],
    indexedAt: string
  ) {
    const stmt = await txn.prepareAsync(UPSERT_SEARCH_SQL);
    try {
      for (const doc of docs) {
        await stmt.executeAsync(searchDocParams(doc, indexedAt));
      }
    } finally {
      await stmt.finalizeAsync();
    }
  }

  return {
    async apply(docs) {
      if (docs.length === 0) return;
      const indexedAt = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        await upsertInTxn(txn, docs, indexedAt);
      });
    },

    async applyWindow(roomId, docs) {
      const indexedAt = new Date().toISOString();
      await db.withExclusiveTransactionAsync(async (txn) => {
        if (docs.length === 0) {
          await txn.runAsync("DELETE FROM search_index WHERE room_id = ?", [
            roomId,
          ]);
          return;
        }
        // Mirror MessageRepository.replaceNewestWindow: clear the page's time
        // range so index rows for messages deleted server-side don't linger.
        const oldest = docs.reduce<string | null>(
          (min, d) =>
            min == null || d.created_at < min ? d.created_at : min,
          null
        );
        if (oldest != null) {
          await txn.runAsync(
            "DELETE FROM search_index WHERE room_id = ? AND created_at >= ?",
            [roomId, oldest]
          );
        }
        await upsertInTxn(txn, docs, indexedAt);
      });
    },

    async removeByMessage(messageId) {
      await db.runAsync("DELETE FROM search_index WHERE message_id = ?", [
        messageId,
      ]);
    },

    async removeByRoom(roomId) {
      await db.runAsync("DELETE FROM search_index WHERE room_id = ?", [roomId]);
    },

    async pruneRoom(roomId, keep) {
      await db.runAsync(
        `DELETE FROM search_index
          WHERE room_id = ? AND message_id NOT IN (
            SELECT message_id FROM search_index
             WHERE room_id = ?
             ORDER BY created_ms DESC LIMIT ?
          )`,
        [roomId, roomId, keep]
      );
    },

    async removeOrphans() {
      await db.runAsync(
        "DELETE FROM search_index WHERE message_id NOT IN (SELECT id FROM messages)"
      );
    },

    async search(params) {
      const { kind, roomId, before, limit } = params;
      const mediaLane = kind !== "message";
      const lane = lanePredicate(kind);
      const roomScope = roomId ?? "";
      const beforeClause = before ? " AND si.created_at < ?" : "";

      const tokens = searchTokens(params.query);
      const usable = tokens.filter((t) => t.length >= params.minTokenLen);
      const emptyQuery = params.query.trim().length === 0;

      // Media lanes browse recent items with an empty query (no MATCH); the
      // message lane requires text (RPC parity) — empty query ⇒ no results.
      if (emptyQuery) {
        if (!mediaLane) return { hits: [], path: "empty" };
        const rows = await db.getAllAsync<SearchHitRow>(
          `SELECT si.message_id, si.room_id, si.sender_id, si.type, si.created_at,
                  m.content AS content, m.media_url AS media_url,
                  m.attachments AS attachments,
                  0 AS score, NULL AS snippet, NULL AS highlight
             FROM search_index si
             JOIN messages m ON m.id = si.message_id
            WHERE ${lane}${beforeClause}
            ORDER BY si.created_ms DESC, si.message_id
            LIMIT ?`,
          before ? [before, limit] : [limit]
        );
        return { hits: rows.map(rowToSearchHit), path: "empty" };
      }

      if ((await hasFts()) && usable.length > 0) {
        // Column-scoped for the message lane (body match); both columns for
        // media lanes (filenames / link hosts live in media_text). Explicit
        // AND between prefix terms so "bao cao" ⇒ báo* AND cáo*.
        const matchExpr = mediaLane
          ? usable.map((t) => `"${t}"*`).join(" AND ")
          : usable.map((t) => `text:"${t}"*`).join(" AND ");
        const nowMs = Date.now();
        const args: (string | number)[] = [
          params.weights.bm25,
          params.weights.recency,
          nowMs,
          params.weights.room,
          roomScope,
          params.snippetTokens,
          matchExpr,
        ];
        if (before) args.push(before);
        args.push(limit);
        const rows = await db.getAllAsync<SearchHitRow>(
          `SELECT si.message_id, si.room_id, si.sender_id, si.type, si.created_at,
                  m.content AS content, m.media_url AS media_url,
                  m.attachments AS attachments,
                  (? * bm25(message_fts, 10.0, 2.0)
                   - ? * (1.0 / (1.0 + (? - si.created_ms) / 86400000.0))
                   - ? * (CASE WHEN si.room_id = ? THEN 1 ELSE 0 END)) AS score,
                  snippet(message_fts, 0, '${HL_OPEN}', '${HL_CLOSE}', '…', ?) AS snippet,
                  highlight(message_fts, 0, '${HL_OPEN}', '${HL_CLOSE}') AS highlight
             FROM message_fts
             JOIN search_index si ON si.rowid = message_fts.rowid
             JOIN messages m ON m.id = si.message_id
            WHERE message_fts MATCH ?
              AND ${lane}${beforeClause}
            ORDER BY score ASC, si.created_ms DESC, si.message_id
            LIMIT ?`,
          args
        );
        return { hits: rows.map(rowToSearchHit), path: "fts" };
      }

      // Substring fallback: short query, or a build without FTS5. Still fully
      // local/offline — a bounded scan over the projection. No MATCH ⇒ no bm25,
      // so the blend degrades to recency-first (today's RPC order).
      const like = likePattern(params.query.trim());
      const nowMs = Date.now();
      const textMatch = mediaLane
        ? "(si.text LIKE ? ESCAPE '\\' OR si.media_text LIKE ? ESCAPE '\\')"
        : "si.text LIKE ? ESCAPE '\\'";
      const args: (string | number)[] = [params.weights.recency, nowMs, params.weights.room, roomScope];
      args.push(like);
      if (mediaLane) args.push(like);
      if (before) args.push(before);
      args.push(limit);
      const rows = await db.getAllAsync<SearchHitRow>(
        `SELECT si.message_id, si.room_id, si.sender_id, si.type, si.created_at,
                m.content AS content, m.media_url AS media_url,
                m.attachments AS attachments,
                (- ? * (1.0 / (1.0 + (? - si.created_ms) / 86400000.0))
                 - ? * (CASE WHEN si.room_id = ? THEN 1 ELSE 0 END)) AS score,
                NULL AS snippet, NULL AS highlight
           FROM search_index si
           JOIN messages m ON m.id = si.message_id
          WHERE ${lane} AND ${textMatch}${beforeClause}
          ORDER BY score ASC, si.created_ms DESC, si.message_id
          LIMIT ?`,
        args
      );
      return { hits: rows.map(rowToSearchHit), path: "like" };
    },

    async coverageAudit(limit) {
      const driftRow = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM messages m
          WHERE m.deleted_at IS NULL AND (m.type IS NULL OR m.type <> 'system')
            AND NOT EXISTS (SELECT 1 FROM search_index si WHERE si.message_id = m.id)`
      );
      const rows = await db.getAllAsync<MessageRow>(
        `SELECT m.* FROM messages m
          WHERE m.deleted_at IS NULL AND (m.type IS NULL OR m.type <> 'system')
            AND NOT EXISTS (SELECT 1 FROM search_index si WHERE si.message_id = m.id)
          ORDER BY m.created_at DESC
          LIMIT ?`,
        [limit]
      );
      return { pending: rows.map(rowToMessage), drift: driftRow?.n ?? 0 };
    },

    async count() {
      const row = await db.getFirstAsync<{ n: number }>(
        "SELECT COUNT(*) AS n FROM search_index"
      );
      return row?.n ?? 0;
    },

    async rebuild() {
      // Corruption / schema-hash path (§16.4): tear down the derived FTS layer
      // + empty the projection, then recreate FTS. The caller refills from
      // `messages` via the coverage-repair pass — zero data loss (derived).
      await db.execAsync(
        `DROP TRIGGER IF EXISTS search_index_ai;
         DROP TRIGGER IF EXISTS search_index_ad;
         DROP TRIGGER IF EXISTS search_index_au;
         DROP TABLE IF EXISTS message_fts;
         DELETE FROM search_index;`
      );
      await ensureSearchFtsSchema(db);
      ftsAvailable = null; // re-probe after recreate
    },

    async clear() {
      await db.runAsync("DELETE FROM search_index");
    },
  };
}

// ---------------------------------------------------------------------------

/** Builds the full repository bundle over one open connection. */
export function createRepositories(db: SQLiteDatabase): Repositories {
  return {
    messages: createMessageRepository(db),
    rooms: createRoomRepository(db),
    participants: createParticipantRepository(db),
    attachments: createAttachmentRepository(db),
    syncState: createSyncStateRepository(db),
    outbox: createOutboxRepository(db),
    uploadQueue: createUploadQueueRepository(db),
    search: createSearchRepository(db),
  };
}

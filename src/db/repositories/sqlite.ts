import type { SQLiteDatabase } from "expo-sqlite";
import type {
  Message,
  MessageAttachment,
  MessageWithMeta,
  OutboxItem,
  RoomParticipantWithProfile,
  RoomWithLastMessage,
  SyncState,
} from "@/src/types";
import type {
  AttachmentRepository,
  MessageRepository,
  OutboxRepository,
  ParticipantRepository,
  Repositories,
  RoomRepository,
  SyncStateRepository,
} from "./types";

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

/** Builds the full repository bundle over one open connection. */
export function createRepositories(db: SQLiteDatabase): Repositories {
  return {
    messages: createMessageRepository(db),
    rooms: createRoomRepository(db),
    participants: createParticipantRepository(db),
    attachments: createAttachmentRepository(db),
    syncState: createSyncStateRepository(db),
    outbox: createOutboxRepository(db),
  };
}

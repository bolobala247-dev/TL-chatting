import type { SQLiteDatabase } from "expo-sqlite";
import { SEARCH_SCHEMA_VERSION } from "@/src/lib/constants";

/**
 * Local-cache migration framework.
 *
 * Versioning uses SQLite's built-in `PRAGMA user_version` (0 = fresh file).
 * Each migration bumps the version by exactly one and runs inside an
 * exclusive transaction — a crash mid-migration rolls back atomically and
 * retries on next launch.
 *
 * Rules for future migrations:
 *  - append only; never edit an already-shipped migration
 *  - `toVersion` values must stay sequential (1, 2, 3, …)
 *  - this DB is a droppable cache (server stays the source of truth), so a
 *    migration that's hard to express incrementally may simply DROP + CREATE
 */

interface Migration {
  toVersion: number;
  name: string;
  statements: string[];
}

/**
 * v1 — initial schema (roadmap §15).
 *
 * Design choices:
 *  - Column shapes mirror the Supabase rows 1:1 (snake_case, ISO-8601 TEXT
 *    timestamps) so future hydration is SELECT → JSON.parse → render.
 *  - `reactions` / `poll_votes` are denormalized JSON on the message row,
 *    matching the `MessageWithMeta` embed shape used by chatStore.
 *  - `rooms` stores the `RoomWithLastMessage` RPC payload as JSON — the room
 *    list renders exactly that shape; no reassembly joins needed.
 *  - `attachments` is a dedicated table (queryable media index for the
 *    shared-media screen later); today's `messages.attachments` JSON column
 *    is still persisted verbatim as the render source.
 *  - `status` supports the future outbox ('pending' | 'sent' | 'failed');
 *    Phase 2 writes nothing, so no row ever holds a non-'sent' value yet.
 */
const MIGRATION_001_INITIAL_SCHEMA: Migration = {
  toVersion: 1,
  name: "initial_schema",
  statements: [
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT,
      type TEXT,
      media_url TEXT,
      reply_to TEXT,
      thread_id TEXT,
      has_link INTEGER,
      is_edited INTEGER,
      pinned_at TEXT,
      pinned_by TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      attachments TEXT,
      metadata TEXT,
      reactions TEXT,
      poll_votes TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      created_at TEXT,
      updated_at TEXT
    );`,
    // Hot path for future hydration: newest N messages of one room
    `CREATE INDEX IF NOT EXISTS idx_messages_room_created
       ON messages (room_id, created_at DESC);`,

    `CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY NOT NULL,
      payload TEXT NOT NULL,
      last_message_at TEXT,
      updated_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_rooms_last_message
       ON rooms (last_message_at DESC);`,

    `CREATE TABLE IF NOT EXISTS room_participants (
      id TEXT PRIMARY KEY NOT NULL,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT,
      joined_at TEXT,
      last_read_at TEXT,
      bookmarked_at TEXT,
      profile TEXT,
      updated_at TEXT
    );`,
    `CREATE INDEX IF NOT EXISTS idx_participants_room
       ON room_participants (room_id);`,

    `CREATE TABLE IF NOT EXISTS attachments (
      message_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      PRIMARY KEY (message_id, position)
    );`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_message
       ON attachments (message_id);`,

    // App-level bookkeeping (e.g. owner_user_id, last_synced markers later)
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT
    );`,
  ],
};

/**
 * v2 — incremental-sync cursor store (roadmap §13, design §3.3, §17 C1/C5).
 *
 * One high-water-mark timestamp per scope:
 *  - scope_id = room UUID → the per-room messages cursor
 *  - scope_id = '@rooms'  → the room-list cursor
 * `last_synced_at` holds the max SERVER `updated_at` applied for that scope;
 * it advances forward-only. `has_full_history` / `stale` support the
 * gap-overflow fallback. Same droppable-cache lifecycle as everything else
 * (wiped on logout with the DB file).
 */
const MIGRATION_002_SYNC_STATE: Migration = {
  toVersion: 2,
  name: "sync_state",
  statements: [
    `CREATE TABLE IF NOT EXISTS sync_state (
      scope_id         TEXT PRIMARY KEY NOT NULL,
      last_synced_at   TEXT,
      has_full_history INTEGER NOT NULL DEFAULT 0,
      stale            INTEGER NOT NULL DEFAULT 0,
      updated_at       TEXT
    );`,
  ],
};

/**
 * v3 — offline outbox (Phase 5A, design §3.1, §9.1).
 *
 * A thin queue index keyed 1:1 by message id (the client-minted UUID = the
 * idempotency key). The pending message itself is a real `messages` row
 * (status='pending'), so it hydrates & renders after restart with zero
 * special-casing; this table holds only queue bookkeeping the worker reads:
 *  - created_at → FIFO ordering key (per room)
 *  - attempts / next_attempt_at → persisted backoff (survives restart)
 *  - state → 'pending' (auto-retried) | 'failed' (parked, manual retry)
 * Same droppable-cache lifecycle as everything else (wiped on logout with the
 * DB file — but logout drains first, design §8.3). No destructive change; the
 * `messages.status` column already exists since v1, only now written/read.
 */
const MIGRATION_003_OUTBOX: Migration = {
  toVersion: 3,
  name: "outbox",
  statements: [
    `CREATE TABLE IF NOT EXISTS outbox (
      id              TEXT PRIMARY KEY NOT NULL,
      room_id         TEXT NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error      TEXT,
      state           TEXT NOT NULL DEFAULT 'pending',
      created_at      TEXT NOT NULL,
      updated_at      TEXT
    );`,
    // Due-set scan: pending rows in FIFO (room_id, created_at) order
    `CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox (room_id, created_at);`,
  ],
};

/**
 * v4 — media upload queue (Phase 7A/7B, design §3.2).
 *
 * One row per attachment — the unit of upload work, retry, and progress.
 * The media message itself stays a real `messages` row (status='pending',
 * local staged URIs in `attachments`), mirroring 5A's "message is the
 * payload" shape; this table holds only the binary work list the media
 * worker reads:
 *  - (message_id, position) → the owning attachment slot
 *  - created_at → global FIFO ordering key (authoring instant)
 *  - attempts / next_attempt_at → persisted backoff (survives restart)
 *  - state → 'queued' | 'uploading' | 'uploaded' | 'failed'
 * Independent from the `outbox` table by design (upload plane ≠ delivery
 * plane); the completion gate inserts the outbox row only after every task
 * here is 'uploaded'. Same droppable-cache lifecycle (wiped on logout).
 */
const MIGRATION_004_UPLOAD_QUEUE: Migration = {
  toVersion: 4,
  name: "upload_queue",
  statements: [
    `CREATE TABLE IF NOT EXISTS upload_queue (
      id              TEXT PRIMARY KEY NOT NULL,
      message_id      TEXT NOT NULL,
      room_id         TEXT NOT NULL,
      position        INTEGER NOT NULL,
      kind            TEXT NOT NULL,
      local_uri       TEXT NOT NULL,
      mime            TEXT NOT NULL,
      bytes           INTEGER,
      width           INTEGER,
      height          INTEGER,
      duration_ms     INTEGER,
      thumb           TEXT,
      remote_path     TEXT,
      remote_url      TEXT,
      state           TEXT NOT NULL DEFAULT 'queued',
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error      TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT
    );`,
    // Per-message lookup: completion gate + retry/discard fan-out
    `CREATE INDEX IF NOT EXISTS idx_upload_queue_message
       ON upload_queue (message_id, position);`,
    // Worker due-set scan: active rows in global FIFO order
    `CREATE INDEX IF NOT EXISTS idx_upload_queue_scan
       ON upload_queue (state, created_at);`,
  ],
};

/**
 * v5 — local search index projection (Phase 8A/8B, design §3.1).
 *
 * A DERIVED, droppable projection of the searchable `messages` corpus — NOT a
 * source of truth (§18). `messages.id` is a TEXT PK, but FTS5 external content
 * needs an INTEGER content_rowid, so search is indexed against this dedicated
 * projection (an integer `rowid`), leaving `MessageRepository`'s table — and
 * its ownership — completely untouched (not one column added to `messages`).
 *
 * This migration only CREATEs the plain relational table + its indexes. The
 * FTS5 virtual table and its sync triggers are created OUTSIDE the migration
 * chain, best-effort, by `ensureSearchFtsSchema` (below): a platform build
 * without FTS5 must degrade to a local LIKE scan, never fail the migration and
 * disable the ENTIRE cache. The first fill is the idempotent boot
 * coverage-repair pass (§16.2), so a large existing cache never backfills
 * inside this transaction. Same droppable-cache lifecycle (wiped on logout).
 */
const MIGRATION_005_SEARCH_INDEX: Migration = {
  toVersion: 5,
  name: "search_index",
  statements: [
    `CREATE TABLE IF NOT EXISTS search_index (
      rowid       INTEGER PRIMARY KEY,
      message_id  TEXT NOT NULL UNIQUE,
      room_id     TEXT NOT NULL,
      sender_id   TEXT,
      type        TEXT NOT NULL,
      has_link    INTEGER NOT NULL DEFAULT 0,
      created_ms  INTEGER NOT NULL,
      created_at  TEXT NOT NULL,
      text        TEXT,
      media_text  TEXT,
      indexed_at  TEXT NOT NULL
    );`,
    // Room-scoped search + media-lane browse (ORDER BY created_ms DESC)
    `CREATE INDEX IF NOT EXISTS idx_search_room
       ON search_index (room_id, created_ms DESC);`,
    // Lane predicate + browse ordering by message type
    `CREATE INDEX IF NOT EXISTS idx_search_type
       ON search_index (type, created_ms DESC);`,
  ],
};

// Append-only, ordered by toVersion
const MIGRATIONS: Migration[] = [
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_SYNC_STATE,
  MIGRATION_003_OUTBOX,
  MIGRATION_004_UPLOAD_QUEUE,
  MIGRATION_005_SEARCH_INDEX,
];

export const LATEST_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1]!.toVersion;

/** Brings the database up to LATEST_SCHEMA_VERSION. Idempotent. */
export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version"
  );
  let current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.toVersion <= current) continue;
    if (migration.toVersion !== current + 1) {
      throw new Error(
        `[db] non-sequential migration: at v${current}, next is v${migration.toVersion}`
      );
    }
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const statement of migration.statements) {
        await txn.execAsync(statement);
      }
      // PRAGMA can't be parameterized; toVersion is a compile-time constant
      await txn.execAsync(`PRAGMA user_version = ${migration.toVersion}`);
    });
    current = migration.toVersion;
  }
}

// FTS5 external-content vtable + the three sync triggers that keep it aligned
// with the search_index projection (design §3.2/§3.3). Kept as a SEPARATE
// best-effort step (not a hard migration) so a build lacking FTS5 degrades to
// a local LIKE scan instead of failing runMigrations and disabling the cache.
const FTS_SCHEMA_STATEMENTS = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    text,
    media_text,
    content = 'search_index',
    content_rowid = 'rowid',
    tokenize = "unicode61 remove_diacritics 2",
    prefix = '2 3'
  );`,
  `CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
    INSERT INTO message_fts(rowid, text, media_text)
    VALUES (new.rowid, new.text, new.media_text);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
    INSERT INTO message_fts(message_fts, rowid, text, media_text)
    VALUES ('delete', old.rowid, old.text, old.media_text);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
    INSERT INTO message_fts(message_fts, rowid, text, media_text)
    VALUES ('delete', old.rowid, old.text, old.media_text);
    INSERT INTO message_fts(rowid, text, media_text)
    VALUES (new.rowid, new.text, new.media_text);
  END;`,
];

/**
 * Best-effort creation of the FTS5 layer over the (already-migrated)
 * `search_index` table. Runs on every init AFTER runMigrations, guarded so it
 * can never disable the cache (Phase 8B, design §16.5):
 *  - Returns `true` when `message_fts` exists and is usable (FTS path enabled).
 *  - Returns `false` on any failure (no FTS5 in this build, corrupt vtable) —
 *    the caller keeps the plain `search_index` table and search degrades to a
 *    local LIKE scan (still offline), never a crash.
 *
 * A stored tokenizer/column fingerprint (`meta['search_schema_hash']`) guards
 * against a future SEARCH_SCHEMA_VERSION bump silently serving a stale index:
 * on mismatch the FTS vtable is dropped and recreated (the projection refills
 * via the boot coverage-repair pass). Idempotent; safe to call every launch.
 */
export async function ensureSearchFtsSchema(
  db: SQLiteDatabase
): Promise<boolean> {
  try {
    const stored = await db.getFirstAsync<{ value: string | null }>(
      "SELECT value FROM meta WHERE key = 'search_schema_hash'"
    );
    let repopulate = false;
    if (stored?.value != null && stored.value !== SEARCH_SCHEMA_VERSION) {
      // Tokenizer/column definition changed — drop the derived FTS layer so it
      // is rebuilt fresh. The projection rows survive, so FTS must be
      // repopulated from them (triggers only fire on future writes).
      await db.execAsync(
        `DROP TRIGGER IF EXISTS search_index_ai;
         DROP TRIGGER IF EXISTS search_index_ad;
         DROP TRIGGER IF EXISTS search_index_au;
         DROP TABLE IF EXISTS message_fts;`
      );
      repopulate = true;
    }
    for (const statement of FTS_SCHEMA_STATEMENTS) {
      await db.execAsync(statement);
    }
    if (repopulate) {
      // Rebuild the external-content index from the surviving projection rows.
      await db.execAsync(
        "INSERT INTO message_fts(message_fts) VALUES('rebuild');"
      );
    }
    await db.runAsync(
      `INSERT INTO meta (key, value) VALUES ('search_schema_hash', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SEARCH_SCHEMA_VERSION]
    );
    return true;
  } catch (err) {
    console.error("[db] FTS5 unavailable — search degrades to LIKE scan", err);
    return false;
  }
}

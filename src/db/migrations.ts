import type { SQLiteDatabase } from "expo-sqlite";

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

// Append-only, ordered by toVersion
const MIGRATIONS: Migration[] = [
  MIGRATION_001_INITIAL_SCHEMA,
  MIGRATION_002_SYNC_STATE,
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

import * as SQLite from "expo-sqlite";

/**
 * SQLite connection lifecycle (native).
 *
 * Lowest layer of the local-cache stack (Phase 2 foundation):
 *
 *   UI → Application/Service (databaseService) → Repository → SQLite (here)
 *
 * Nothing above the repository layer may import this module — UI and hooks
 * must never touch SQLite directly.
 *
 * Web builds resolve ./database.web.ts instead (no-op adapter): SQLite is a
 * capability, not a requirement — when unavailable the app keeps its current
 * network-first behavior, consistent with the expo-notifications web-safety
 * convention.
 */

// Single shared cache file for now. When hydration lands (Phase 3+) this can
// switch to a per-user file (logout wipe / multi-account isolation) behind
// the same open/close API without touching higher layers.
const DB_NAME = "talo-local.db";

export const isSqliteAvailable = true;

let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opens (once) and returns the database handle. Safe to call concurrently. */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (opening) return opening;

  opening = (async () => {
    const handle = await SQLite.openDatabaseAsync(DB_NAME);
    // WAL: readers never block the writer — required for the future
    // hydrate-while-syncing access pattern (roadmap §15)
    await handle.execAsync("PRAGMA journal_mode = WAL;");
    await handle.execAsync("PRAGMA foreign_keys = ON;");
    db = handle;
    return handle;
  })();

  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/** Returns the open handle, or null when init hasn't completed (or failed). */
export function getDatabase(): SQLite.SQLiteDatabase | null {
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (!db) return;
  const handle = db;
  db = null;
  await handle.closeAsync();
}

/** Full cache wipe: close + delete the file. Recreated on next openDatabase. */
export async function deleteDatabase(): Promise<void> {
  await closeDatabase();
  await SQLite.deleteDatabaseAsync(DB_NAME);
}

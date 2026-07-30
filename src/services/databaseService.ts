import {
  closeDatabase,
  deleteDatabase,
  isSqliteAvailable,
  openDatabase,
} from "@/src/db/database";
import { runMigrations } from "@/src/db/migrations";
import { createRepositories } from "@/src/db/repositories/sqlite";
import type { Repositories } from "@/src/db/repositories/types";

/**
 * Application-layer facade over the local SQLite cache — the ONLY entry
 * point the rest of the app may use (layering: UI → service → repository →
 * SQLite). Screens, hooks, and stores must never import from `src/db/*`.
 *
 * Phase 3 (hydration): stores consume the cache exclusively through
 * `cacheService`, which wraps the `repositories` bundle exposed here.
 *
 * Failure policy: the cache is strictly optional. Every failure path logs
 * and leaves the service unavailable — app behavior is then identical to
 * today's network-first flow (same convention as the web no-op adapter).
 */
export const databaseService = {
  _repositories: null as Repositories | null,
  _initializing: null as Promise<void> | null,

  /** True when SQLite exists on this platform (false on web). */
  get isAvailable(): boolean {
    return isSqliteAvailable;
  },

  /** True once init completed successfully (repositories usable). */
  get isReady(): boolean {
    return this._repositories !== null;
  },

  /**
   * Repository bundle for future data phases; null until init succeeds
   * (and always null on web). Callers must handle null = cache disabled.
   */
  get repositories(): Repositories | null {
    return this._repositories;
  },

  /**
   * Opens the database and applies pending migrations. Idempotent and
   * concurrency-safe; never throws (failures only disable the cache tier).
   */
  async init(): Promise<void> {
    if (!isSqliteAvailable || this._repositories) return;
    if (this._initializing) return this._initializing;

    this._initializing = (async () => {
      try {
        const db = await openDatabase();
        await runMigrations(db);
        this._repositories = createRepositories(db);
      } catch (err) {
        console.error("[databaseService] init failed — cache disabled", err);
      } finally {
        this._initializing = null;
      }
    })();

    return this._initializing;
  },

  /** Closes the connection (e.g. before background teardown). */
  async close(): Promise<void> {
    this._repositories = null;
    await closeDatabase().catch((err) =>
      console.error("[databaseService] close", err)
    );
  },

  /**
   * Deletes the database file entirely (logout — cached plaintext must not
   * survive an account switch). Next init() recreates the schema from
   * scratch via the migration chain.
   */
  async wipe(): Promise<void> {
    this._repositories = null;
    await deleteDatabase().catch((err) =>
      console.error("[databaseService] wipe", err)
    );
  },
};

/**
 * Web no-op adapter for the SQLite connection layer.
 *
 * expo-sqlite's wasm/OPFS backend needs extra Metro config and COOP/COEP
 * headers; per roadmap §15 the web build simply degrades to today's
 * network-first behavior. Callers must gate on `isSqliteAvailable` — the
 * function bodies exist only to keep one import path for both platforms.
 */

// Minimal structural type so repositories can share one signature across
// platforms without importing expo-sqlite types on web.
export type WebSQLiteDatabase = {
  execAsync: (sql: string) => Promise<void>;
  runAsync: (sql: string, ...params: unknown[]) => Promise<unknown>;
  getFirstAsync: <T>(sql: string, ...params: unknown[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
  withExclusiveTransactionAsync: (
    task: (txn: WebSQLiteDatabase) => Promise<void>
  ) => Promise<void>;
  closeAsync: () => Promise<void>;
};

export const isSqliteAvailable = false;

export async function openDatabase(): Promise<never> {
  throw new Error("SQLite không khả dụng trên web (isSqliteAvailable=false)");
}

export function getDatabase(): null {
  return null;
}

export async function closeDatabase(): Promise<void> {
  // no-op
}

export async function deleteDatabase(): Promise<void> {
  // no-op
}

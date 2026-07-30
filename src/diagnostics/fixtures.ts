import type { MessageWithMeta } from "@/src/types";

/**
 * Synthetic fixtures for the dev-only diagnostics harnesses (Phase 6B — §4–§6).
 *
 * These build in-memory `MessageWithMeta` rows to exercise the *pure* building
 * blocks (the repository-owned merge, the registry) under load. They never
 * touch SQLite, Supabase, or the store — a harness measuring throughput must
 * not perturb real state (Invariants #1–#3). The cast is deliberate: a harness
 * fixture only needs the fields the pure functions read (id, created_at), so we
 * synthesize those and cast rather than enumerate every DB column.
 */

// Build `count` newest-first rows for room `roomId`, oldest at `baseMs`.
export function makeMessages(
  roomId: string,
  count: number,
  baseMs: number = Date.UTC(2025, 0, 1)
): MessageWithMeta[] {
  const rows: MessageWithMeta[] = [];
  for (let i = 0; i < count; i++) {
    // Newest-first: index 0 is the most recent (largest created_at).
    const createdMs = baseMs + (count - 1 - i) * 1000;
    rows.push({
      id: `${roomId}-msg-${i}`,
      room_id: roomId,
      created_at: new Date(createdMs).toISOString(),
      content: `bench ${i}`,
      type: "text",
    } as unknown as MessageWithMeta);
  }
  return rows;
}

// A delta batch of `count` NEW rows that continue after `afterMs` (no overlap).
export function makeDelta(
  roomId: string,
  count: number,
  afterMs: number = Date.UTC(2025, 0, 2)
): MessageWithMeta[] {
  const rows: MessageWithMeta[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `${roomId}-delta-${i}`,
      room_id: roomId,
      created_at: new Date(afterMs + i * 1000).toISOString(),
      content: `delta ${i}`,
      type: "text",
    } as unknown as MessageWithMeta);
  }
  return rows;
}

// High-resolution clock; falls back to Date.now when performance is absent.
export function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

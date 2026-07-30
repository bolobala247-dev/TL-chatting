import type { MessageWithMeta } from "@/src/types";

/**
 * Repository-layer merge logic for synchronization batches (Invariant #3).
 *
 * Pure and idempotent: applying the same server batch twice yields the same
 * window. Dedups by message id (server row wins on content/flags), preserves
 * the locally-embedded reactions/votes (the delta select does not re-embed
 * them; the live realtime path keeps them current — §4.3/§17 C4), re-sorts
 * newest-first by created_at, and caps to the in-memory window size.
 *
 * No SQLite, no store, no side effects — this is the single place that knows
 * how server rows reconcile with an existing window. Both the RAM patch
 * (via syncService/chatStore) and reasoning about persistence use it.
 */

// Server row wins on every server-authoritative field; local meta embeds are
// preserved because the delta does not carry them.
function mergeRow(
  existing: MessageWithMeta,
  server: MessageWithMeta
): MessageWithMeta {
  return {
    ...server,
    message_reactions: existing.message_reactions,
    poll_votes: existing.poll_votes,
  };
}

export function mergeMessageWindow(
  existing: MessageWithMeta[],
  incoming: MessageWithMeta[],
  cap: number
): MessageWithMeta[] {
  if (incoming.length === 0) return existing;

  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const row of incoming) {
    const prev = byId.get(row.id);
    byId.set(row.id, prev ? mergeRow(prev, row) : row);
  }

  const merged = Array.from(byId.values());
  // Parse each timestamp once (not per comparison) before sorting — mirrors
  // the one-parse sort in chatStore.fetchMessages.
  const timeById = new Map(
    merged.map((m) => [m.id, new Date(m.created_at ?? 0).getTime()])
  );
  merged.sort((a, b) => timeById.get(b.id)! - timeById.get(a.id)!);

  return merged.length > cap ? merged.slice(0, cap) : merged;
}

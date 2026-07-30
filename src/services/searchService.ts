import { supabase } from "@/src/lib/supabase";
import { databaseService } from "@/src/services/databaseService";
import { diag } from "@/src/lib/diagnostics";
import {
  FEATURE_LOCAL_SEARCH,
  SEARCH_MIN_TOKEN_LEN,
  SEARCH_PAGE_SIZE,
  SEARCH_RANK_W_BM25,
  SEARCH_RANK_W_RECENCY,
  SEARCH_RANK_W_ROOM,
  SEARCH_SNIPPET_TOKENS,
} from "@/src/lib/constants";
import type {
  MatchRange,
  MessageAttachment,
  MessageSearchKind,
  MessageSearchResult,
  Profile,
  RoomWithLastMessage,
  SearchHit,
} from "@/src/types";

/**
 * Search service (Phase 8A/8B — design §7).
 *
 * Gains a **local-first** path behind `FEATURE_LOCAL_SEARCH`, while keeping the
 * exact `searchMessages(query, kind, opts) → MessageSearchResult[]` contract so
 * `app/search.tsx` is untouched (invariant: search must never affect rendering).
 *
 * Flag off, cache unavailable, or any local error ⇒ delegate to the legacy
 * server `search_messages` RPC, byte-identical to today (§16.5/§16.6). On the
 * local path, `SearchRepository` runs a single ranked SQL pass over the SQLite
 * cache — fully offline — and this service:
 *  - injects the ranking-weight policy (§8) the repo computes the blend from,
 *  - hydrates hits to `MessageSearchResult` from the already-cached
 *    rooms/participants/profiles (no network; missing fields degrade to null),
 *  - assembles the optional highlight/snippet side-channel (§9/§10) that the
 *    current screen ignores and renders exactly as today.
 */

// Control-char delimiters the SearchRepository wraps FTS matches in (must match
// HL_OPEN/HL_CLOSE in repositories/sqlite.ts) — never occur in chat text.
const HL_OPEN = "\u0002";
const HL_CLOSE = "\u0003";

// A hydrated hit plus the optional highlight/snippet side-channel (§9/§10). It
// IS a MessageSearchResult (structurally), so it is assignable to the screen's
// type; the extra fields are additive and the current UI never reads them.
export interface SearchResultRow extends MessageSearchResult {
  /** Windowed preview excerpt (FTS snippet, or a synthesized fallback). */
  snippet?: string | null;
  /** Matched spans against `content`, for a future opt-in bolded render. */
  ranges?: MatchRange[];
}

/**
 * Convert FTS `highlight()` output (matches wrapped in U+0002/U+0003) into the
 * plain string plus `{ start, length }` offsets against it. Pure; O(len).
 */
export function toHighlightRanges(highlighted: string): {
  plain: string;
  ranges: MatchRange[];
} {
  let plain = "";
  const ranges: MatchRange[] = [];
  let open = -1;
  for (const ch of highlighted) {
    if (ch === HL_OPEN) {
      open = plain.length;
      continue;
    }
    if (ch === HL_CLOSE) {
      if (open >= 0) {
        ranges.push({ start: open, length: plain.length - open });
        open = -1;
      }
      continue;
    }
    plain += ch;
  }
  return { plain, ranges };
}

// Drop the highlight delimiters, leaving a clean excerpt string.
function stripDelimiters(s: string): string {
  return s.split(HL_OPEN).join("").split(HL_CLOSE).join("");
}

// Snippet for the side-channel: the FTS excerpt when present, else the trimmed
// content, else a synthesized label for a media/empty-content hit (§10).
function buildSnippet(hit: SearchHit): string | null {
  if (hit.snippet) return stripDelimiters(hit.snippet);
  if (hit.content && hit.content.trim().length > 0) return hit.content.trim();
  const atts = Array.isArray(hit.attachments)
    ? (hit.attachments as unknown as MessageAttachment[])
    : null;
  const named = atts?.find((a) => a?.name)?.name;
  if (named) return named;
  return null;
}

// The ranking-weight policy the repo blends the score from (§8). Constants, not
// magic numbers — documented and tunable; w_bm25=0 degrades to recency-only.
const RANK_WEIGHTS = {
  bm25: SEARCH_RANK_W_BM25,
  recency: SEARCH_RANK_W_RECENCY,
  room: SEARCH_RANK_W_ROOM,
} as const;

// Hydrate a page of index hits to MessageSearchResult using ONLY cached data —
// room name/type from cached rooms, sender name/avatar from cached participant
// profiles. Bounded by the page (≤ distinct rooms in ≤ SEARCH_PAGE_SIZE hits).
async function hydrate(hits: SearchHit[]): Promise<SearchResultRow[]> {
  const repos = databaseService.repositories;

  const roomsById = new Map<string, RoomWithLastMessage>();
  const profilesByRoom = new Map<string, Map<string, Profile>>();

  if (repos && hits.length > 0) {
    try {
      for (const r of await repos.rooms.getAll()) roomsById.set(r.room_id, r);
    } catch (err) {
      console.error("[searchService] hydrate rooms", err);
    }
    const distinctRooms = [...new Set(hits.map((h) => h.room_id))];
    await Promise.all(
      distinctRooms.map(async (roomId) => {
        try {
          const parts = await repos.participants.getByRoom(roomId);
          const byUser = new Map<string, Profile>();
          for (const p of parts) if (p.profiles) byUser.set(p.profiles.id, p.profiles);
          profilesByRoom.set(roomId, byUser);
        } catch (err) {
          console.error("[searchService] hydrate participants", err);
        }
      })
    );
  }

  return hits.map((h) => {
    const room = roomsById.get(h.room_id);
    const sender = h.sender_id
      ? profilesByRoom.get(h.room_id)?.get(h.sender_id) ?? null
      : null;
    const ranges = h.highlight ? toHighlightRanges(h.highlight).ranges : [];
    return {
      id: h.message_id,
      room_id: h.room_id,
      sender_id: h.sender_id,
      content: h.content,
      type: h.type,
      media_url: h.media_url,
      attachments: h.attachments,
      created_at: h.created_at,
      sender_name: sender?.display_name ?? sender?.username ?? null,
      sender_avatar: sender?.avatar_url ?? null,
      room_name: room?.room_name ?? null,
      // room_type is non-null in the shape; the cached room supplies it, and an
      // uncached room (global hit) defaults to 'direct' (the screen never reads
      // room_type — it only chooses room_name || sender_name for the title).
      room_type: room?.room_type ?? "direct",
      snippet: buildSnippet(h),
      ranges,
    };
  });
}

export const searchService = {
  // Backed by the search_messages RPC (trgm index, scoped to my rooms).
  // Media lanes accept an empty query (browse recent), the message lane
  // requires text — the RPC enforces the same rule.
  async searchMessages(
    query: string,
    kind: MessageSearchKind,
    options?: { roomId?: string; before?: string; limit?: number }
  ): Promise<MessageSearchResult[]> {
    const limit = options?.limit ?? SEARCH_PAGE_SIZE;

    // Local-first path (Phase 8B): flag on + cache ready ⇒ query SQLite FTS,
    // fully offline. Any failure falls back to the server RPC below (§16.6).
    if (FEATURE_LOCAL_SEARCH) {
      const repo = databaseService.repositories?.search;
      if (repo) {
        const started = Date.now();
        try {
          const { hits, path } = await repo.search({
            query: query.trim(),
            kind,
            roomId: options?.roomId,
            before: options?.before,
            limit,
            weights: RANK_WEIGHTS,
            snippetTokens: SEARCH_SNIPPET_TOKENS,
            minTokenLen: SEARCH_MIN_TOKEN_LEN,
          });
          diag.observe("search.query_ms", Date.now() - started, { path });
          diag.observe("search.results", hits.length);
          diag.count("search.path", 1, { path });
          return await hydrate(hits);
        } catch (err) {
          console.error("[searchService] local search failed — RPC fallback", err);
          diag.count("search.error", 1);
          // fall through to the server RPC
        }
      }
    }

    return this.searchMessagesRemote(query, kind, { ...options, limit });
  },

  /**
   * Legacy server path — today's `search_messages` RPC, unchanged. Used when
   * the flag is off, the cache is unavailable, or a local query errored, and
   * retained as the opt-in deep-history augmentation (§7/§12).
   */
  async searchMessagesRemote(
    query: string,
    kind: MessageSearchKind,
    options?: { roomId?: string; before?: string; limit?: number }
  ): Promise<MessageSearchResult[]> {
    const { data, error } = await supabase.rpc("search_messages", {
      p_query: query.trim(),
      p_kind: kind,
      p_room_id: options?.roomId,
      p_before: options?.before,
      p_limit: options?.limit ?? SEARCH_PAGE_SIZE,
    });

    if (error) throw error;
    return (data ?? []) as MessageSearchResult[];
  },
};

import { databaseService } from "@/src/services/databaseService";
import { diag } from "@/src/lib/diagnostics";
import {
  FEATURE_LOCAL_SEARCH,
  SEARCH_REPAIR_BATCH,
} from "@/src/lib/constants";
import type {
  MessageAttachment,
  MessageWithMeta,
  SearchDoc,
} from "@/src/types";

/**
 * Search indexer (Phase 8A/8B — design §2, §6, §16).
 *
 * The write-through hook that maps every `MessageWithMeta` reaching the cache
 * funnel into the derived `search_index` projection. It is a *passenger* on the
 * existing `cacheService` write-through seam (beside `advanceMessageCursors`) —
 * it introduces no new ingest path, so "synchronization architecture unchanged"
 * holds (§6, invariant).
 *
 * Contracts, mirroring the surrounding write-through style:
 *  - Flag-gated: every method no-ops unless `FEATURE_LOCAL_SEARCH` is on, so
 *    with the flag off the app makes ZERO extra SQLite writes — byte-identical
 *    to Phase 7B. The boot coverage-repair pass fills the index the first time
 *    the flag flips on (§16.2/§16.3).
 *  - Best-effort: never throws into the caller, never blocks or rolls back a
 *    message write — the message row already committed before we run (§2.2 r5).
 *  - Derived only: writes exclusively the `SearchRepository`'s own tables; the
 *    projection is rebuildable from `messages` at any time (§16, invariant).
 *
 * The `MessageWithMeta → SearchDoc` mapping is the pure `buildSearchDoc` helper
 * so the repository stays SQL-only (mirrors the existing row↔domain rule).
 */

// The search repo type, derived from the service facade (no `src/db/*` import,
// keeping the service-layer boundary the same as the rest of this file).
type SearchRepo = NonNullable<typeof databaseService.repositories>["search"];

// Filename/basename from a storage URL (drop query/hash, take the last path
// segment, best-effort decode) — the searchable label for a media attachment.
function basename(url: string): string | null {
  try {
    const path = url.split(/[?#]/)[0] ?? url;
    const seg = path.split("/").pop();
    if (!seg) return null;
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  } catch {
    return null;
  }
}

// Host of an http(s) URL (for the `link` lane) — no URL() dependency so it is
// safe on every RN runtime; a malformed URL simply contributes no host.
function hostFromUrl(raw: string): string | null {
  const m = raw.match(/^https?:\/\/([^/\s?#]+)/i);
  return m ? m[1]! : null;
}

// FTS column 1 (§11): attachment kind keyword + filename/basename, plus link
// hosts extracted from the body of a link message. Empty ⇒ null (no media_text).
function buildMediaText(m: MessageWithMeta): string | null {
  const parts: string[] = [];

  const attachments = Array.isArray(m.attachments)
    ? (m.attachments as unknown as MessageAttachment[])
    : null;
  if (attachments) {
    for (const a of attachments) {
      if (!a || typeof a !== "object") continue;
      parts.push(a.kind ?? "image");
      if (a.name) parts.push(a.name);
      if (a.url) {
        const base = basename(a.url);
        if (base) parts.push(base);
      }
    }
  }

  // Link hosts live in the body — surface them so "figma.com" finds the message.
  if (m.has_link === true && m.content) {
    const urls = m.content.match(/https?:\/\/[^\s]+/gi) ?? [];
    for (const u of urls) {
      const host = hostFromUrl(u);
      if (host) parts.push(host);
    }
  }

  const joined = parts.join(" ").trim();
  return joined.length > 0 ? joined : null;
}

/**
 * Pure projection of one message into a `SearchDoc`, or `null` when the row is
 * NOT searchable — reproducing the server RPC's visibility exactly (§2.2 r1):
 * a `temp-`/optimistic row, a soft-deleted row (`deleted_at` set), and a
 * `system` message are never indexed. A NULL `type` coerces to `text` (indexed).
 */
export function buildSearchDoc(m: MessageWithMeta): SearchDoc | null {
  if (m.id.startsWith("temp-")) return null;
  if (m.deleted_at != null) return null;
  const type = m.type ?? "text";
  if (type === "system") return null;

  // created_at is the sort key + pagination cursor; fall back defensively so a
  // legacy row with a null timestamp still indexes (search_index.created_at is
  // NOT NULL) rather than crashing the batch.
  const createdAt = m.created_at ?? m.updated_at ?? new Date(0).toISOString();
  const parsed = Date.parse(createdAt);

  return {
    message_id: m.id,
    room_id: m.room_id,
    sender_id: m.sender_id ?? null,
    type,
    has_link: m.has_link === true,
    created_ms: Number.isNaN(parsed) ? 0 : parsed,
    created_at: createdAt,
    text: m.content,
    media_text: buildMediaText(m),
  };
}

// Split a write-through batch: indexable rows → docs, and rows that turned
// UN-indexable (soft-deleted / became system) → ids to evict, so an edit that
// deletes a message drops it from the index in the same pass (§2.2 r2/r3).
function partition(rows: MessageWithMeta[]): {
  toIndex: SearchDoc[];
  toRemove: string[];
} {
  const toIndex: SearchDoc[] = [];
  const toRemove: string[] = [];
  for (const m of rows) {
    if (m.id.startsWith("temp-")) continue; // never indexed → nothing to evict
    const doc = buildSearchDoc(m);
    if (doc) toIndex.push(doc);
    else toRemove.push(m.id);
  }
  return { toIndex, toRemove };
}

// Refresh the row-count gauge (I-S3 bound). Guarded by diag.enabled() so it
// costs a COUNT query only when diagnostics are on — zero cost in production.
async function tapIndexRows(repo: SearchRepo): Promise<void> {
  if (!diag.enabled()) return;
  try {
    diag.gauge("search.index_rows", await repo.count());
  } catch {
    /* swallow — telemetry must never break the host path */
  }
}

export const searchIndexer = {
  /**
   * Index (or re-index) a write-through batch — the passenger on
   * `cacheService.saveMessages`. Idempotent (upsert by message_id); rows that
   * became un-searchable are evicted in the same call.
   */
  async apply(rows: MessageWithMeta[]): Promise<void> {
    if (!FEATURE_LOCAL_SEARCH) return;
    const repo = databaseService.repositories?.search;
    if (!repo || rows.length === 0) return;
    const started = Date.now();
    try {
      const { toIndex, toRemove } = partition(rows);
      if (toIndex.length > 0) await repo.apply(toIndex);
      for (const id of toRemove) await repo.removeByMessage(id);
      diag.observe("search.apply_ms", Date.now() - started);
      diag.observe("search.apply_rows", toIndex.length);
      await tapIndexRows(repo);
    } catch (err) {
      console.error("[searchIndexer] apply", err);
    }
  },

  /**
   * Page-1 window reconcile — the passenger on `cacheService.saveMessagePage`.
   * Mirrors `MessageRepository.replaceNewestWindow`: index the page and drop
   * indexed rows in the page's time range that are gone server-side (§6).
   */
  async applyPage(roomId: string, rows: MessageWithMeta[]): Promise<void> {
    if (!FEATURE_LOCAL_SEARCH) return;
    const repo = databaseService.repositories?.search;
    if (!repo) return;
    const started = Date.now();
    try {
      const docs = rows
        .map(buildSearchDoc)
        .filter((d): d is SearchDoc => d !== null);
      await repo.applyWindow(roomId, docs);
      diag.observe("search.apply_ms", Date.now() - started);
      diag.observe("search.apply_rows", docs.length);
      await tapIndexRows(repo);
    } catch (err) {
      console.error("[searchIndexer] applyPage", err);
    }
  },

  /** Evict one message — the passenger on `cacheService.deleteMessage`. No-op if absent. */
  async remove(messageId: string): Promise<void> {
    if (!FEATURE_LOCAL_SEARCH) return;
    const repo = databaseService.repositories?.search;
    if (!repo) return;
    try {
      await repo.removeByMessage(messageId);
      await tapIndexRows(repo);
    } catch (err) {
      console.error("[searchIndexer] remove", err);
    }
  },

  /** Cap a room's indexed rows — the passenger on `cacheService.pruneRoom` (§2.2 r4). */
  async pruneRoom(roomId: string, keep: number): Promise<void> {
    if (!FEATURE_LOCAL_SEARCH) return;
    const repo = databaseService.repositories?.search;
    if (!repo) return;
    try {
      await repo.pruneRoom(roomId, keep);
      await tapIndexRows(repo);
    } catch (err) {
      console.error("[searchIndexer] pruneRoom", err);
    }
  },

  /**
   * Boot coverage-repair pass (§16.2/§16.3) + the initial fill. Drops orphaned
   * index rows, then re-indexes any searchable cached message missing from the
   * index, in bounded chunks that yield between batches so first paint and
   * interactions are never blocked. Idempotent; converges to drift ≈ 0.
   */
  async repair(): Promise<void> {
    if (!FEATURE_LOCAL_SEARCH) return;
    const repo = databaseService.repositories?.search;
    if (!repo) return;
    const started = Date.now();
    try {
      await repo.removeOrphans(); // I-S2: no index row without a backing message
      let indexed = 0;
      for (;;) {
        const { pending, drift } = await repo.coverageAudit(SEARCH_REPAIR_BATCH);
        if (diag.enabled()) diag.gauge("search.coverage_drift", drift);
        if (pending.length === 0) break;
        const docs = pending
          .map(buildSearchDoc)
          .filter((d): d is SearchDoc => d !== null);
        if (docs.length === 0) break; // guard: nothing indexable ⇒ never loop
        await repo.apply(docs);
        indexed += docs.length;
        // Yield to the event loop between chunks (§16.2 — never blocks paint).
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (indexed > 0) {
        diag.event("search.repair", { indexed, ms: Date.now() - started });
      }
      await tapIndexRows(repo);
    } catch (err) {
      console.error("[searchIndexer] repair", err);
    }
  },
};

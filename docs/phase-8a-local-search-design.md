# Phase 8A — Local Search & Indexing Architecture (Design)

> **Status:** DESIGN ONLY. No code ships in this phase. Every component below is
> additive and flag-gated (`FEATURE_LOCAL_SEARCH`, default `false`); with the flag
> off, search behaves byte-for-byte like today's server-backed `search_messages`
> path. Rollback is flipping the flag back to `false`.

Talo is offline-first: the SQLite cache (`PRAGMA user_version` = 4) already holds
the message history that the room list and chat screens render from. Today's
search, however, is **online-only** — `searchService.searchMessages` calls the
server RPC `search_messages` (ILIKE, scoped to my rooms). This phase designs a
**local, full-text search index over the existing cache** so search works with no
network, returns results in milliseconds, and never becomes a second source of
truth.

---

## Requirement → section map

| Brief item | Section |
|---|---|
| 1. Full-text indexing architecture | §1, §3, §5 |
| 2. Search Service | §7 |
| 3. Search Repository | §4 |
| 4. FTS strategy | §5 |
| 5. Incremental index updates | §6 |
| 6. Search ranking | §8 |
| 7. Highlight generation | §9 |
| 8. Snippet generation | §10 |
| 9. Media search | §11 |
| 10. Offline search | §12 |
| 11. Performance budget | §13 |
| 12. Benchmark strategy | §14 |
| 13. Diagnostics integration | §15 |
| 14. Failure recovery | §16 |
| 15. Rollout strategy | §17 |
| Architectural invariants | §18 |

---

## 0. Problem statement & scope

### What we have today (verified against the repository)

- **SQLite cache** (`src/db/migrations.ts`, v4): `messages`, `rooms`,
  `room_participants`, `attachments`, `sync_state`, `outbox`, `upload_queue`,
  `meta`. The DB is a **droppable cache** — the server stays the source of truth,
  and the whole file is wiped on logout.
- **Repositories** (`src/db/repositories/types.ts` + `sqlite.ts`): the storage
  boundary. `MessageRepository` is the **sole writer of `messages`**;
  `AttachmentRepository` owns `attachments`; each queue plane owns its own table.
  Stores/hooks/UI never touch repos directly — everything funnels through
  `cacheService`.
- **Write-through seam** (`cacheService`): every message that enters the cache
  passes through `saveMessages` (`upsertMany`), `saveMessagePage`
  (`replaceNewestWindow`), `deleteMessage`, or `pruneRoom`. This is the same funnel
  Phase 4 used to advance sync cursors (`advanceMessageCursors`).
- **Incremental sync** (Phase 4): `syncService` + a pure `mergeMessageWindow` +
  forward-only `sync_state` cursors. All ingest lands in `cacheService.saveMessages`.
- **Outbox** (Phase 5A, v3) and **Media pipeline** (Phase 7A/7B, v4): two
  independent durable planes. Search touches neither.
- **Diagnostics** (Phase 6B, `src/lib/diagnostics.ts`): the `diag` registry —
  passive, exception-isolated, zero-cost when disabled, bounded
  (`DIAG_MAX_SERIES`, fixed ring). Taps never return a value the host branches on.
- **Existing search**: `searchService.searchMessages(query, kind, opts)` → RPC
  `search_messages` (ILIKE substring, `get_my_room_ids()` scope, excludes
  `deleted_at` and `type='system'`). Lanes: `message | image | file | link`.
  `app/search.tsx` consumes `MessageSearchResult[]`. Debounce 300 ms, page 20.

### The cost we are removing

Search is unusable offline and adds a network round-trip on every keystroke-batch.
ILIKE is a full scan on the server with no relevance ranking (pure `created_at`
DESC). Users on flaky networks — the exact users offline-first serves — get the
worst search experience.

### Phase 8A objective

Add a **derived, local full-text index** over the cached corpus, queried by a
local-first `searchService`, producing ranked results with highlights and
snippets — fully offline — while leaving messages as the only source of truth and
the render path untouched.

### In scope

- SQLite **FTS5** index over a repository-owned **search projection table**.
- A new `SearchRepository` + a `searchIndexer` write-through hook.
- Local-first `searchService` returning the **existing `MessageSearchResult`
  shape** (so `app/search.tsx` is unchanged), plus optional highlight/snippet
  side-channels.
- Ranking (BM25 + recency), snippet + highlight generation, media/link lanes,
  incremental maintenance, failure recovery, diagnostics, benchmarks, rollout.

### Explicitly OUT of scope (hard constraints)

- **No change to synchronization** — `syncService`, `mergeMessageWindow`,
  `sync_state`, cursors, realtime channels, and ingest order are untouched. The
  indexer is a *reader* of the same rows sync already writes.
- **No change to existing repository ownership** — `MessageRepository` remains the
  sole writer of `messages`. A **new** `SearchRepository` is added beside the
  others (the same additive pattern Phase 7 used for `UploadQueueRepository`).
- **No change to the render flow** — no chat/list component changes; search
  results keep the current shape.
- **No server changes required** — the server `search_messages` RPC is retained
  unchanged as an *optional* online augmentation (§12); local search never depends
  on it.
- Cross-device index sync, server-side FTS, semantic/vector search, and search
  analytics upload are all future phases.

### New dependencies

**None.** Expo SDK 56's `expo-sqlite` bundles SQLite with **FTS5 compiled in**;
`bm25()`, `snippet()`, and `highlight()` are built-in auxiliary functions. No
native module, no PREP case. (A runtime capability probe covers the rare build
without FTS5 — see §16.5.)

---

## 1. Architecture

### 1.1 One derived plane, zero coupling to the source of truth

```
             writes (unchanged)                       reads (new, derived)
messages  ───────────────────────►  cacheService  ───────────────────────►  searchService
(source of truth, MessageRepository) │  saveMessages / saveMessagePage /       (local-first)
                                     │  deleteMessage / pruneRoom                   │
                                     │        │ (same funnel that advances          │ SearchRepository.search
                                     │        │  sync cursors — Phase 4)            ▼
                                     │        └──► searchIndexer.apply(rows) ──► search_index  ──► message_fts (FTS5)
                                     │            (best-effort, own txn,          (projection,     (external-content
                                     │             idempotent, swallowed)          SearchRepo)      index only)
```

The index is a **pure function of the cache**: `search_index` + `message_fts` hold
only a *derived projection* of rows that already exist in `messages`. They can be
dropped and rebuilt at any time with zero data loss (§16). Nothing reads the index
to make a delivery, sync, or render decision — it is queried *only* by the search
screen.

### 1.2 Layering (Phase 3/4/5A/7 layering; one table pair + one repo + one hook added)

| Layer | Existing | Added in 8A |
|---|---|---|
| Screen | `app/search.tsx` | *(unchanged — same result shape)* |
| Service | `searchService` (server RPC) | `searchService` gains a **local-first** path; pure `buildSearchDoc()` / `blendRank()` / `toHighlightRanges()` helpers |
| Indexer | — | `searchIndexer` (write-through hook, mirrors `advanceMessageCursors`) |
| Store/Hook | — | *(none — search is screen-local state today)* |
| Repository | `messages`, `attachments`, … | **`SearchRepository`** (owns `search_index` + `message_fts`) |
| DB | v4 | **v5** migration: `search_index` + `message_fts` + sync triggers |

### 1.3 New / changed components at a glance

| Component | Kind | Responsibility |
|---|---|---|
| `MIGRATION_005_SEARCH_INDEX` | new (db) | Create `search_index`, the `message_fts` FTS5 external-content vtable, and the three sync triggers. |
| `SearchRepository` | new (repo) | All FTS SQL: `apply`, `removeByMessage`, `removeByRoom`, `pruneRoom`, `search`, `coverageAudit`, `rebuild`, `clear`. Sole owner of `search_index`/`message_fts`. |
| `searchIndexer` | new (service) | Maps `MessageWithMeta → SearchDoc` and calls the repo; wired into `cacheService` write-through. Best-effort, own txn. |
| `searchService` | changed (service) | Local-first orchestration behind `FEATURE_LOCAL_SEARCH`; ranking blend, highlight/snippet assembly. Falls back to today's RPC when the flag is off or FTS is unavailable. |
| `cacheService` | changed (thin) | Adds `searchIndexer` calls beside the existing write-through calls (one line each, fire-and-forget). |
| constants | changed | `FEATURE_LOCAL_SEARCH` + budgets (§13). |
| diagnostics | changed | `search.*` taps + auditor invariants I-S1..I-S4 (§15). |

> **Note on the brief's "SQLite migration v4":** v4 is already shipped
> (`MIGRATION_004_UPLOAD_QUEUE`, media pipeline). Migrations are append-only and
> sequential, so the search index is **v5** (`MIGRATION_005_SEARCH_INDEX`).

---

## 2. Search document model & lifecycle

### 2.1 The `SearchDoc` projection

`searchIndexer` reduces each `MessageWithMeta` to a flat, searchable projection.
The mapping is a pure helper (`buildSearchDoc`), keeping the repository SQL-only
(mirroring the existing row↔domain rule):

| Field | Source | Use |
|---|---|---|
| `message_id` | `message.id` | idempotency key (UNIQUE) |
| `room_id`, `sender_id` | message | filter / room-scoped search |
| `type` | message | lane mapping |
| `has_link` | message | `link` lane |
| `created_ms` | `Date.parse(created_at)` | recency ranking + sort (integer, fast) |
| `created_at` | message | cursor pagination (parity with RPC `p_before`) |
| `text` | `content` | primary FTS column (weight 10) |
| `media_text` | attachment filenames/basenames + kind keyword + extracted URL hosts | secondary FTS column (weight 2) — powers media/link lanes |

### 2.2 Lifecycle rules (mirror the server RPC's visibility exactly)

1. **Index on ingest.** Every row reaching `cacheService.saveMessages` /
   `saveMessagePage` is offered to `searchIndexer.apply`. A row is indexed iff it
   is *searchable*: `deleted_at IS NULL` **and** `type <> 'system'` **and** not a
   `temp-`/pending optimistic row (`isPersistable`, reused from the cache filter).
2. **Re-index on edit.** An edited message (`is_edited`, new `content`) re-enters
   the funnel; `apply` is `INSERT OR REPLACE` by `message_id`, so re-indexing is a
   single idempotent upsert. FTS stays consistent via triggers (§3.3).
3. **Remove on delete/recall.** A soft delete (`deleted_at` set), hard delete, or
   recall flows through `deleteMessage` → `searchIndexer.removeByMessage`. Removing
   a non-indexed id is a no-op. This guarantees a recalled message never surfaces —
   matching the RPC's `deleted_at IS NULL` filter.
4. **Prune in lockstep.** `cacheService.pruneRoom(roomId, keep)` already caps disk
   history at `MAX_PERSISTED_PER_ROOM`. The indexer's `removeByRoom`/`pruneRoom`
   mirror it so the index **never indexes more than the cache holds** — the index
   is bounded by the cache, by construction.
5. **Never blocks the write.** `apply`/`remove` run in their **own** transaction,
   after the message write has committed, with errors swallowed (like every other
   `cacheService` write-through). An index failure can never roll back or delay a
   message write (§16, invariant #1/#2).
6. **Rebuildable.** The index carries no state the cache lacks; §16 can drop and
   rebuild it from `messages` at any time.

---

## 3. SQLite migration v5 — schema

Append-only, sequential, runs inside the existing exclusive-transaction framework
(`runMigrations`). Because the cache is droppable, this migration is a pure
`CREATE` — no data backfill in the migration itself (the initial fill is an
idempotent background pass, §16.2, so a large cache never blocks launch inside the
migration txn).

### 3.1 Projection table (`search_index`) — owned by `SearchRepository`

```sql
CREATE TABLE IF NOT EXISTS search_index (
  rowid       INTEGER PRIMARY KEY,          -- FTS content_rowid (stable, integer)
  message_id  TEXT NOT NULL UNIQUE,         -- idempotency key
  room_id     TEXT NOT NULL,
  sender_id   TEXT,
  type        TEXT NOT NULL,
  has_link    INTEGER NOT NULL DEFAULT 0,
  created_ms  INTEGER NOT NULL,             -- recency ranking + sort
  created_at  TEXT NOT NULL,                -- pagination cursor (RPC parity)
  text        TEXT,                          -- FTS column 0 (content)
  media_text  TEXT,                          -- FTS column 1 (filenames/urls/kind)
  indexed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_room     ON search_index (room_id, created_ms DESC);
CREATE INDEX IF NOT EXISTS idx_search_type     ON search_index (type, created_ms DESC);
```

A dedicated projection (rather than pointing FTS directly at `messages`) is
deliberate: `messages.id` is a **TEXT** PK, but FTS5 external content requires an
**INTEGER** `content_rowid`. The projection also lets the `SearchRepository` own
its storage outright without a single column being added to `messages` — so
`MessageRepository`'s ownership is untouched (invariant).

### 3.2 FTS5 virtual table (`message_fts`) — external content, index-only

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  text,
  media_text,
  content            = 'search_index',
  content_rowid      = 'rowid',
  tokenize           = "unicode61 remove_diacritics 2",
  prefix             = '2 3'
);
```

`content='search_index'` makes this an **external-content** table: FTS5 stores only
the inverted index, **not a copy of the text**. The text itself lives once, in
`search_index.text`, which is itself a projection of `messages.content`. This keeps
storage lean and reinforces that the index is derived, not authoritative.

### 3.3 Sync triggers (keep FTS consistent with the projection)

External-content FTS5 is kept in sync with three standard triggers, so the
`SearchRepository` writes **only** `search_index` and FTS follows automatically:

```sql
CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
  INSERT INTO message_fts(rowid, text, media_text)
  VALUES (new.rowid, new.text, new.media_text);
END;
CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
  INSERT INTO message_fts(message_fts, rowid, text, media_text)
  VALUES ('delete', old.rowid, old.text, old.media_text);
END;
CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
  INSERT INTO message_fts(message_fts, rowid, text, media_text)
  VALUES ('delete', old.rowid, old.text, old.media_text);
  INSERT INTO message_fts(rowid, text, media_text)
  VALUES (new.rowid, new.text, new.media_text);
END;
```

`apply` becomes a single `INSERT ... ON CONFLICT(message_id) DO UPDATE` on
`search_index`; the triggers translate it into the correct FTS delete+insert. This
is the canonical FTS5 external-content maintenance pattern.

---

## 4. Search Repository

Added to the `Repositories` bundle beside the existing ones; interface in
`repositories/types.ts`, implementation in `repositories/sqlite.ts` (same file the
other repos live in, so row↔domain mapping stays private). It owns **only**
`search_index` + `message_fts`. It knows SQL/FTS — **not** networks, ranking
policy weights, debounce, or the `MessageSearchResult` shape (that is
`searchService`).

```ts
export interface SearchRepository {
  /** Idempotent upsert of N projected docs (INSERT OR REPLACE by message_id), one txn. */
  apply(docs: SearchDoc[]): Promise<void>;
  /** Remove a message from the index (delete / recall). No-op if absent. */
  removeByMessage(messageId: string): Promise<void>;
  /** Drop a whole room's index rows (leave room / cache eviction). */
  removeByRoom(roomId: string): Promise<void>;
  /** Keep only the newest `keep` indexed rows of a room (lockstep with cache prune). */
  pruneRoom(roomId: string, keep: number): Promise<void>;
  /**
   * Ranked FTS query. Returns index-local hit rows (ids + score + created_at +
   * FTS snippet + highlight offsets); searchService hydrates them to
   * MessageSearchResult. `kind` maps to the same lane predicate as the RPC.
   */
  search(params: SearchQuery): Promise<SearchHit[]>;
  /** Ids present in `messages` (searchable) but missing/stale in the index (§16.2). */
  coverageAudit(limit: number): Promise<{ missing: string[]; drift: number }>;
  /** DROP + CREATE the index tables, then return (caller refills). Corruption path (§16.4). */
  rebuild(): Promise<void>;
  clear(): Promise<void>;
}
```

`SearchQuery` = `{ query, kind, roomId?, before?, limit }` (a superset of the RPC
arguments); `SearchHit` = `{ message_id, room_id, created_at, score, snippet,
ranges }`.

---

## 5. FTS strategy

### 5.1 Tokenizer choice: `unicode61 remove_diacritics 2`

- **Diacritic- and case-insensitive.** Vietnamese users routinely type without
  tone marks ("cam on" for "cảm ơn"); `remove_diacritics 2` folds both the index
  and the query, so toneless queries match toned content. This is a *better* match
  experience than today's diacritic-sensitive server ILIKE.
- **Language-agnostic word boundaries.** `unicode61` splits on Unicode separators,
  covering VN + EN (the app's two locales) without English-only stemming baggage.
  We deliberately do **not** use the `porter` stemmer — it would mangle Vietnamese.
- **Prefix indexing (`prefix='2 3'`)** powers as-you-type: a 2- or 3-char prefix is
  answered from a prefix index rather than a scan, so `searchService` can query on
  each debounced keystroke-batch cheaply.

### 5.2 Query construction

- Tokenize the trimmed query the same way (fold diacritics), then build an FTS5
  MATCH expression: each token as a **prefix term** (`tok*`) AND-ed together, so
  "bao cao" matches "báo cáo hàng tháng". The last token is always a prefix term
  (as-you-type); earlier tokens are prefix terms too (forgiving matching).
- User input is **never string-concatenated into the MATCH grammar** — tokens are
  extracted with a whitelist (`[\p{L}\p{N}]+` after folding) and quoted, so FTS5
  operators (`"`, `*`, `:`, `AND`, `NEAR`) in raw input can't inject. This is the
  FTS analogue of parameterization.

### 5.3 Short-query & substring fallback

FTS is token-oriented; two cases fall back to a **bounded ILIKE scan over the
cache** (still fully local/offline):

1. Query shorter than `SEARCH_MIN_TOKEN_LEN` (default 2) — below the prefix floor.
2. A user explicitly seeking an infix substring inside a token (rare).

The fallback reuses `search_index.text` (`WHERE text LIKE '%q%'` with the same lane
filter), capped at the cache size — never a network call. `searchService` chooses
the path; the choice is tapped (`search.path{fts|like}`, §15).

---

## 6. Incremental index updates

**The indexer is a passenger on the existing write-through funnel** — it introduces
no new ingest path, honoring "synchronization architecture unchanged."

| `cacheService` funnel (existing) | Added call (fire-and-forget) |
|---|---|
| `saveMessages(rows)` (upserts, realtime, confirmed sends, delta apply) | `searchIndexer.apply(rows)` |
| `saveMessagePage(roomId, rows)` (page-1 refresh) | `searchIndexer.applyPage(roomId, rows)` (reconciles the window: index the page, drop indexed rows older than the page's tail that are gone) |
| `deleteMessage(id)` | `searchIndexer.remove(id)` |
| `pruneRoom(roomId, keep)` | `searchIndexer.pruneRoom(roomId, keep)` |

Each added call sits **beside** the existing `advanceMessageCursors(rows)` call —
the exact seam Phase 4 chose for cursor maintenance — and is `void`-ed with a
`.catch(console.error)`, identical to the surrounding write-through style. Because
Phase 4 already guarantees *every* user-visible message mutation funnels here,
the index inherits complete coverage for free: delta-sync deltas, realtime echoes,
optimistic-send confirmations, and history pages all flow through unchanged.

Batching: `apply` takes the whole `rows` array (typically ≤ `DELTA_SYNC_LIMIT`),
one transaction — the same batch granularity sync already uses.

---

## 7. Search Service

`searchService` gains a **local-first** path, flag-gated, returning the **existing
`MessageSearchResult[]`** so `app/search.tsx` is unchanged (invariant: search must
never affect rendering).

```
search(query, kind, opts):
  if !FEATURE_LOCAL_SEARCH || !searchRepoAvailable:
      return legacy searchMessages(...)         // today's server RPC, byte-identical
  hits = SearchRepository.search({ ...RPC-parity args })   // local, offline
  results = hydrate(hits)                        // → MessageSearchResult[] (same shape)
  return results (+ optional highlight/snippet side-channel)
```

- **Hydration** maps a `SearchHit` to `MessageSearchResult`. The heavy joins the
  RPC does (sender name/avatar, room name, DM peer name) are served from the
  already-cached `rooms`/`room_participants`/profile data — no network. Fields the
  cache can't fill degrade gracefully to `null` (the type already allows it).
- **Pagination parity**: `before` = `created_at` cursor, `limit` =
  `SEARCH_PAGE_SIZE` — identical to the RPC, so the screen's infinite-scroll works
  unchanged.
- **Optional online augmentation** (§12): for a query whose room isn't fully cached
  (`sync_state.has_full_history=0`), `searchService` *may* additionally fire the
  server RPC and union deeper hits behind the local ones. This is an enhancement,
  never a dependency — with no network, local results stand alone.
- The service owns the **ranking blend** (§8) and **highlight/snippet assembly**
  (§9/§10); the repo returns raw FTS artifacts, the service shapes them.

Ownership: `searchService` orchestrates, `SearchRepository` does SQL, the screen
renders the same type. No store, no hook, no component changes.

---

## 8. Search ranking

The repo orders by a **blended score** computed in SQL, so ranking is a single
pass, no post-sort in JS:

```
score =  w_bm25   * bm25(message_fts, 10.0, 2.0)     -- text col ×10, media_text ×2 (bm25 is negative; lower = better)
       - w_recent * recency_boost(created_ms)         -- newer ranks higher
       - w_room   * (room_id = :roomId)                -- in-room hits float up when scoped
```

- **BM25** is FTS5's built-in relevance; weighting `text` above `media_text` keeps
  a body match ahead of an incidental filename match.
- **Recency boost** = a bounded function of age (e.g. `1 / (1 + age_days)`), so a
  strong old match still beats a weak fresh one but recency breaks near-ties — this
  matches chat intuition (recent conversations first) without collapsing to pure
  `created_at DESC` (today's RPC behavior, which ignores relevance entirely).
- **Deterministic tie-break**: `created_ms DESC, message_id` — stable pagination.
- Weights (`SEARCH_RANK_W_*`) are constants (tunable, documented), not magic
  numbers. Default weights reproduce a sensible relevance-then-recency order; a
  weight of `w_bm25=1, w_recent=0` degrades exactly to relevance-only, and
  `w_bm25=0` degrades to today's recency-only order (useful for A/B and rollback
  reasoning).

---

## 9. Highlight generation

- FTS5's built-in `highlight(message_fts, 0, <open>, <close>)` wraps matched terms.
  We invoke it with **control-char delimiters** (`U+0002`/`U+0003`) that never
  occur in chat text, then `searchService.toHighlightRanges()` converts them into
  an array of `{ start, length }` offsets against the plain text.
- Results carry these ranges as an **optional side-channel field**
  (`ranges?: MatchRange[]`), not inside the required `MessageSearchResult` shape.
  **The current screen ignores it and renders exactly as today** (invariant: never
  affect rendering); a future opt-in can bold the ranges. Returning offsets rather
  than pre-wrapped markup keeps rendering the UI's decision, not the service's.
- Highlighting is computed only for the returned page (≤ `SEARCH_PAGE_SIZE` rows),
  so it is O(page), not O(corpus).

---

## 10. Snippet generation

- FTS5's `snippet(message_fts, 0, '', '', '…', :tokens)` produces a windowed
  excerpt centered on the match with ellipses, bounded to `SEARCH_SNIPPET_TOKENS`
  (default ~10 tokens). This is the value that populates the result's preview text.
- **Parity fallback**: today's screen shows `content` directly. When the flag is
  off, or for a `like`-path result, the snippet is the same trimmed `content` the
  RPC returns — so switching the flag changes *relevance and offline-ability*, not
  the visual shape of a row.
- **Media/empty-content rows** (image/file with `content IS NULL`) get a synthesized
  snippet from `media_text` (filename + kind), so a media hit still shows a
  meaningful line. Snippet length is capped to protect list-row layout.

---

## 11. Media search

Media is searched through the same index, via the `media_text` FTS column and the
lane predicate — reproducing today's `image | file | link` lanes exactly:

- **`media_text` content**: attachment filename/basename (from the attachment URL
  path or `metadata`), a kind keyword (`image`/`video`/`file`), and extracted URL
  hosts for link messages. So "invoice.pdf" or "figma.com" become searchable even
  though `messages.content` is empty.
- **Lane → predicate** (identical to `search_messages`):
  - `image` → `type IN ('image','video')`
  - `file` → `type = 'file'`
  - `link` → `has_link = 1`
  - `message` → `type IN ('text','image','video','file')` with a `text` match
  - media lanes accept an **empty query** (browse recent) — served by
    `ORDER BY created_ms DESC` over the lane, no MATCH, still local/offline.
- The **Media Pipeline** integration is read-only: a media message authored through
  Phase 7B carries `attachments[].{width,height,kind,thumb}`; the indexer reads
  those additive fields to build `media_text` and to preserve the thumbnail path
  for the result row. The indexer **never** writes to `upload_queue` or influences
  upload/completion — it only projects the already-persisted message row.

---

## 12. Offline search

This is the phase's reason to exist. With `FEATURE_LOCAL_SEARCH` on:

- **All search is local** — `SearchRepository.search` runs entirely against the
  SQLite cache. No network is required or attempted on the primary path. Airplane
  mode, dead server, captive portal: search still returns instantly.
- **Coverage = the cache.** Local search covers exactly the history the cache holds
  (bounded by `MAX_PERSISTED_PER_ROOM` per room). That is the same corpus the chat
  screens can already show offline, so results are consistent with what the user
  can open. `sync_state.has_full_history` tells the service when a room's local
  view is complete.
- **Online augmentation is opt-in and additive** (§7): when connected *and* a
  room's history isn't fully cached, the service may union deeper server hits after
  the local ones — clearly separated, never blocking, and fully degradable. The
  server RPC is retained unchanged precisely so this augmentation needs no backend
  work.
- **Logout** wipes the index with the DB file (same droppable-cache lifecycle);
  nothing extra to clear.

---

## 13. Performance budget

Corpus is bounded: `MAX_PERSISTED_PER_ROOM` (1000) × cached rooms. Realistic
ceiling ≈ tens of thousands of rows — trivial for FTS5.

| Operation | Budget (p95) | Mechanism |
|---|---|---|
| Query (FTS, cached corpus ≤ 50k rows) | **< 30 ms** | inverted index + prefix index; single ranked SQL pass |
| As-you-type keystroke-batch | reuses `SEARCH_DEBOUNCE_MS` (300 ms) | prefix terms; last query cancels prior (request-id guard already in the screen) |
| Incremental `apply` (per batch ≤ 200 rows) | **< 8 ms** amortized | one txn; triggers are O(tokens); off the render thread (fire-and-forget) |
| Snippet + highlight (per page ≤ 20) | **< 5 ms** | FTS aux functions, O(page) |
| Full rebuild (50k rows) | **< 2 s**, off critical path | background pass, chunked, yields |
| Index disk footprint | ≈ 0.3–0.5× indexed text | external-content stores index only, not a text copy |
| RAM | ~0 steady-state | index lives on disk; queries stream rows; no in-memory corpus |

Budgets are asserted by the benchmark harness (§14) and observed live by
diagnostics (§15). Missing a budget is a rollout blocker, not a silent regression.

---

## 14. Benchmark strategy

Extend the existing dev-only harness (`src/diagnostics/benchmarkHarness.ts`,
`fixtures.ts`) with a **search group**, over synthetic corpora — deterministic, no
device I/O, mirroring the media benchmark added in Phase 7B.

- **Fixtures** (`makeSearchCorpus(n, opts)`): synthetic `SearchDoc[]` with
  realistic token distributions (mixed VN/EN, media filenames, link hosts) at sizes
  `[1_000, 10_000, 50_000]`.
- **Scenarios**:
  - `index_apply` — throughput (rows/s) applying corpora in `apply`-sized batches.
  - `query_latency` — p50/p95 for single-token, multi-token prefix, empty-media-lane,
    and short-query `like`-fallback queries, at each corpus size.
  - `snippet_highlight` — cost per page.
  - `rebuild` — full-index build time at each size.
- **Memory** — drive repeated `apply`→`search`→`remove` cycles through
  `memoryLeakDetector`; assert no monotonic heap growth (index bytes live on disk,
  JS heap must stay flat).
- Output rides the existing `BenchmarkReport` shape (a new `search: SearchTiming[]`
  field), so the Phase 7 benchmark-reporting path is reused.

---

## 15. Diagnostics integration

All taps go through the Phase 6B `diag` registry — passive, exception-isolated,
zero-cost when `FEATURE_RELIABILITY_DIAGNOSTICS` is off, never awaited, never
branched-on-value. New series (bounded by `DIAG_MAX_SERIES`):

| Series | Type | Meaning |
|---|---|---|
| `search.query_ms` | histogram (labels `path=fts\|like`) | end-to-end query latency |
| `search.results` | histogram | result count per query |
| `search.apply_ms` / `search.apply_rows` | histogram | incremental index cost |
| `search.path{fts\|like\|empty}` | counter | fallback rate (a spike ⇒ tokenizer/flag issue) |
| `search.index_rows` | gauge | current `search_index` row count |
| `search.coverage_drift` | gauge | `messages(searchable) − search_index` (should hover at 0) |
| `search.rebuild` | event | rebuild reason + duration |

**Auditor invariants** (read-only over snapshots, dev/flag only):

- **I-S1** — coverage: every searchable cached message has an index row
  (`coverage_drift ≈ 0`; a sustained non-zero drift flags a broken hook).
- **I-S2** — no orphans: no `search_index` row lacks a backing `messages` row.
- **I-S3** — bound: `search.index_rows ≤ Σ cached messages` (index never exceeds
  the cache).
- **I-S4** — determinism: identical query + corpus ⇒ identical ordered ids
  (ranking is a pure function of indexed state).

---

## 16. Failure recovery

The index is **derived and droppable** — every failure mode degrades to "rebuild
from the cache" or "fall back to a scan," never to data loss and never to blocking
messages.

1. **Idempotent apply.** `apply` is `INSERT OR REPLACE` by `message_id`; a retried
   or duplicated batch converges. A failed `apply` is swallowed and logged; the
   message write already committed.
2. **Boot coverage repair (drift heal).** On launch (after migrations, gated by the
   flag) a bounded background pass runs `coverageAudit(limit)` and re-indexes any
   missing/stale ids in chunks. This closes any window where a write-through hook
   was skipped (e.g. an `apply` threw). It is incremental, yields between chunks,
   and never blocks first paint.
3. **Initial fill.** The v5 migration only *creates* tables; the first fill is the
   same coverage-repair pass (§16.2) — so upgrading a user with a large existing
   cache doesn't run a heavy backfill inside the migration transaction.
4. **FTS corruption / schema-hash mismatch.** A `SQLITE_CORRUPT` from the vtable, or
   a stored `meta['search_schema_hash']` that doesn't match the current tokenizer/
   column definition, triggers `rebuild()` (DROP + CREATE + refill via §16.2). The
   hash guards against a future tokenizer change silently serving a stale index.
5. **FTS5 unavailable (capability probe).** On first use, `searchService` probes
   `CREATE VIRTUAL TABLE ... fts5` in a throwaway statement (result cached in
   `meta`). If the platform build lacks FTS5, the service **degrades to the ILIKE
   scan over `search_index.text`** (§5.3) — still local and offline, just without
   ranking — or, if even the projection is absent, to today's server RPC. No crash.
6. **Query failure isolation.** Any error inside `SearchRepository.search` is caught
   by `searchService`, tapped (`search.error`), and the service falls back (like →
   server) so the screen shows *some* result, never a crash.
7. **Logout.** Index tables wiped with the DB file (droppable-cache lifecycle); no
   special drain (unlike the outbox — there is nothing durable to preserve).

---

## 17. Rollout strategy

- **Kill switch:** `FEATURE_LOCAL_SEARCH` (default `false`). Off ⇒
  `searchService.search` delegates to today's `search_messages` RPC, byte-identical;
  the index tables may exist but are never read. Independent of
  `FEATURE_DELTA_SYNC` / `FEATURE_OFFLINE_OUTBOX` / `FEATURE_MEDIA_PIPELINE` /
  `FEATURE_RELIABILITY_DIAGNOSTICS` — toggling search can never change delivery,
  sync, or media behavior.
- **Build order** (each step additive or flag-gated; between steps the app is never
  worse than Phase 7B):
  1. `MIGRATION_005_SEARCH_INDEX` (create tables/vtable/triggers) — dormant, no reads.
  2. `SearchRepository` interface + SQLite impl; unit-test `apply`/`search`/`rebuild`.
  3. `searchIndexer` + the four `cacheService` write-through hooks (still no reads).
  4. Coverage-repair boot pass (§16.2) + capability probe (§16.5).
  5. `searchService` local-first path behind the flag; `buildSearchDoc`, `blendRank`,
     highlight/snippet assembly.
  6. Diagnostics taps + auditor I-S1..I-S4; benchmark search group + fixtures.
  7. §13 device-matrix pass (airplane, large corpus, corruption injection, old-SQLite
     degrade).
  8. Dogfood with the flag on → staged rollout → full enable.
  9. One release later: consider retiring the server RPC as a *primary* path (keep it
     as the deep-history augmentation).
- **Rollback:** flip the flag to `false`. The index on disk is inert and harmless;
  it is reclaimed on the next logout/DB wipe, or an explicit one-shot `clear()` can
  drop it. No migration reversal is needed (append-only; the tables simply go unread).

---

## 18. Architectural invariants — compliance

| Invariant | Mechanism in this design |
|---|---|
| **Search must never affect rendering** | No chat/list component changes. `searchService` returns the **existing `MessageSearchResult` shape**, so `app/search.tsx` is untouched. Highlight/snippet are additive optional side-channels the current UI ignores (§9/§10). Indexing is fire-and-forget on its own txn, off the render path (§6). |
| **Search index must never become the source of truth** | `search_index`/`message_fts` are a **derived projection** (external-content = index only), droppable and rebuildable from `messages` at any time (§16). Nothing reads the index for a sync/delivery/render decision — only the search screen queries it. |
| **Messages remain the only source of truth** | `MessageRepository` stays the sole writer of `messages`; the indexer is a **reader** of the same rows and writes only its own derived tables. A schema-hash + coverage audit continually re-derive the index *from* messages, never the reverse. |
| **Search updates must be incremental** | The indexer rides the existing write-through funnel (`saveMessages`/`saveMessagePage`/`deleteMessage`/`pruneRoom`), applying only the batch just written (§6). Full rebuild is a recovery path, not the steady state. |
| **Synchronization architecture must remain unchanged** | Zero edits to `syncService`, `mergeMessageWindow`, `sync_state`, cursors, realtime channels, or ingest order. The indexer hooks the *same* seam Phase 4 used for cursor advance, beside it, without altering it (§6). |
| **Repository ownership must remain unchanged** | One **new** `SearchRepository` is added beside the existing repos (the Phase 7 `UploadQueueRepository` pattern). No existing repository gains/loses/shares responsibility; not one column is added to `messages`/`attachments` (§3.1, §4). |
| **Search must remain fully functional offline** | The primary path is 100% local SQLite FTS over the cache — no network required or attempted (§12). Online server search is an opt-in, degradable augmentation only. Even without FTS5, a local ILIKE scan keeps search working offline (§16.5). |

---

## 19. Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| Point FTS5 directly at `messages` (`content='messages'`) | ❌ | `messages.id` is TEXT; FTS5 external content needs an INTEGER `content_rowid`. Would also entangle `MessageRepository`'s table with search triggers — violating repository ownership. The `search_index` projection decouples both. |
| Contentless FTS5 (`content=''`) | ⚠️ rejected | Simpler, but contentless-delete needs a recent SQLite (`contentless_delete`) and complicates edit/recall removal. External content over a projection is robust across SDK 56's SQLite and gives clean incremental deletes via triggers. |
| `trigram` tokenizer (substring/CJK) | ⏭ future | Great for infix substring and CJK, but weak ranking and a ≥3-char floor. `unicode61 remove_diacritics 2` + prefix + a bounded ILIKE fallback covers VN/EN better today; trigram can be added as a second index later. |
| Index inside the message write txn (transactional consistency) | ❌ | Would let an index failure roll back a message write — search affecting the source of truth. A separate best-effort txn + coverage repair gives eventual consistency without that risk. |
| Keep server-only search, add caching | ❌ | Doesn't work offline — the whole point. Server RPC is retained only as an optional deep-history augment. |
| Index in a Zustand store / in-memory structure | ❌ | Unbounded RAM, lost on restart, rebuilt every launch. SQLite FTS is on-disk, bounded, and already the cache engine. |
| Server-side FTS (Postgres `tsvector`) as primary | ⏭ future | Correct end-state for cross-device/deep search, but it's a network dependency and a backend change — out of scope for an offline-first phase. Lands with the augmentation layer. |

---

## 20. Implementation checklist (build order)

1. `MIGRATION_005_SEARCH_INDEX`: `search_index` + `message_fts` (fts5 external
   content) + three sync triggers; store `search_schema_hash` in `meta`.
2. `SearchRepository` interface (`repositories/types.ts`) + SQLite impl
   (`repositories/sqlite.ts`); add to the `Repositories` bundle.
3. `searchIndexer` service + pure `buildSearchDoc`; wire the four `cacheService`
   write-through hooks (dormant — no reads yet).
4. Coverage-repair boot pass + FTS5 capability probe (`meta`-cached).
5. `searchService` local-first path behind `FEATURE_LOCAL_SEARCH`; ranking blend,
   `snippet()`/`highlight()` assembly, hydration to `MessageSearchResult`.
6. `constants`: `FEATURE_LOCAL_SEARCH` + `SEARCH_*` budgets/weights.
7. Diagnostics `search.*` taps + auditor I-S1..I-S4; benchmark search group +
   `makeSearchCorpus` fixtures + memory pass.
8. §13 device matrix (airplane, 50k corpus, corruption injection, old-SQLite
   degrade, logout wipe).
9. Dogfood with the flag on → staged rollout → full enable (§17).

> Every step is additive or flag-gated; between steps the app is never worse than
> Phase 7B, and nothing changes user-visibly until `FEATURE_LOCAL_SEARCH` is set.

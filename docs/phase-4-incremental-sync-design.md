# Phase 4 — Incremental Synchronization Architecture (Design)

> **Status:** Design only. No production code in this phase.
> **Roadmap anchor:** Milestone C · **C1 — Delta Sync** (roadmap §6, §8-reconnect, §13).
> **Feature flag:** `FEATURE_DELTA_SYNC`.
> **Depends on:** Phase 3 (Local Cache Integration) — hydrate-first stores, `cacheService`,
> SQLite repositories, write-through persistence, logout wipe.
> **Goal of this doc:** be complete enough that Phase 4 can be implemented without any further
> design decisions.

---

## 0. Problem statement & scope

### What we have after Phase 3

- Steady-state live updates come from `room:${roomId}` (per-room `postgres_changes`) and the
  unfiltered `global:messages` channel — see [useRealtime.ts](file:///Users/dabeeovina/Documents/TL-chatting/src/hooks/useRealtime.ts).
- **On reconnect** the message channel refetches **page 1** (`fetchMessages(roomId)` with no
  cursor) — [useRealtime.ts#L238-L248](file:///Users/dabeeovina/Documents/TL-chatting/src/hooks/useRealtime.ts#L238-L248).
- **On reconnect / foreground** the room channel does a full `get_user_rooms` refetch
  (`resync()`) — [useRealtime.ts#L399-L426](file:///Users/dabeeovina/Documents/TL-chatting/src/hooks/useRealtime.ts#L399-L426).
- Rendering is memory-store-first; SQLite is persistence only, reached through
  [cacheService.ts](file:///Users/dabeeovina/Documents/TL-chatting/src/services/cacheService.ts).

### The cost we are removing (roadmap B5)

Every reconnect / foreground pays two **full** payloads (page-1 messages + full room list)
regardless of how little actually changed. On flaky mobile networks this is the dominant
avoidable traffic and the main "app feels slow after unlock" symptom.

### Phase 4 objective

Replace the two **recovery** fetches (reconnect page-1 refetch, reconnect/foreground room-list
refetch) with **incremental deltas** keyed by a per-room / per-list cursor, applied through a
single merge path that writes SQLite and patches the in-RAM window. Steady-state realtime is
**unchanged**.

### In scope

- `get_room_messages_since` RPC (per-room message delta, includes tombstones).
- `get_rooms_delta` RPC (room-list delta).
- Optional `touch_message_on_reaction` trigger (makes reaction/vote changes delta-visible).
- Client `sync_state` bookkeeping (SQLite migration v2).
- A new `syncService` that owns cursors, coalescing, retry, and the merge algorithm.
- Wiring reconnect / foreground / room-open / pull-to-refresh to `syncService` **behind the flag**.
- Type regeneration (`src/types/database.ts`) via the standard workflow.

### Explicitly OUT of scope (hard constraints)

- ❌ Offline write queue / outbox (that is B2, a later phase).
- ❌ Any change to pagination logic (`MESSAGES_PER_PAGE`, cursor-by-`created_at`, `loadMore`).
- ❌ Any change to **steady-state** realtime behavior (the `postgres_changes` handlers stay
  byte-for-byte; only the *reconnect recovery action* changes).
- ❌ Presence changes.
- ❌ New npm dependencies.
- ❌ Per-user broadcast channel / unread-counter rewrite (that is C2).
- ❌ Changing public store/hook API surfaces used by screens/components.

---

## 1. Architecture

### 1.1 Layering (unchanged from Phase 3, one box added)

```
        Screen (app/) ── hooks (useMessages / useRooms / useRealtime) ── unchanged API
                                   │
                         Memory Store (Zustand)              ← single source of truth for render
                    chatStore.messages / roomStore.rooms
                                   ▲            │
                     patch window  │            │ applyServerMessages(roomId, rows)
                                   │            ▼
        ┌──────────────────────────┴───────── syncService ──────────────────────────┐
        │  cursors · coalescing · retry · merge · gap-overflow fallback (NEW)        │
        └───────┬───────────────────────────────────────────────────┬───────────────┘
        read/write │ (via cacheService)                    delta RPC │ (via messageService/roomService)
                ┌──▼─────────────┐                          ┌────────▼─────────┐
                │  cacheService  │  ← Phase 3 facade         │    Supabase       │
                │  repositories  │                          │  RPC: *_since /   │
                │  + syncState   │                          │  *_delta          │
                └──┬─────────────┘                          │  Realtime: room:$ │
                   │                                         │  (unchanged)      │
                ┌──▼─────────────┐                          └───────────────────┘
                │ SQLite (WAL)   │
                │ messages/rooms │
                │ + sync_state   │
                └────────────────┘
```

**Key rule preserved:** SQLite → repository → cacheService → store → UI for rendering; Supabase
→ syncService → (store + cacheService) for ingest. SQLite never drives the UI; Supabase never
writes the UI directly.

### 1.2 The single-writer principle (scoped)

`syncService.applyServerMessages(roomId, rows)` becomes the **one** function that merges
*server-originated batches* (delta pulls, reconnect recovery, and — optionally, later —
realtime). In Phase 4 we route **only the delta/recovery batches** through it. Steady-state
realtime `postgres_changes` continues to call the existing `chatStore.addMessage` /
`updateMessage` / `removeMessage` directly, because those handlers already write-through to
SQLite (Phase 3) and changing them is out of scope.

> This is deliberate: `applyServerMessages` and the realtime handlers share the **same store
> mutators** (`addMessage`/`updateMessage`/`removeMessage` already dedup + write-through), so
> the two ingest paths are consistent without rewriting the realtime layer.

### 1.3 New / changed components at a glance

| Component | Type | Responsibility |
|-----------|------|----------------|
| `src/services/syncService.ts` | **NEW** | Cursors, scope coalescing, retry, merge, fallback. The only owner of delta logic. |
| `src/db/repositories/syncState.ts` (+ interface in `types.ts`) | **NEW** | Read/write per-room + per-list sync cursors. |
| SQLite migration v2 | **NEW** | `sync_state` table. |
| `messageService.getRoomMessagesSince()` | **NEW method** | Wraps `get_room_messages_since` RPC. |
| `roomService.getRoomsDelta()` | **NEW method** | Wraps `get_rooms_delta` RPC. |
| `cacheService` | **+ methods** | `getSyncState` / `setSyncState`; expose `syncState` repo (never-throw). |
| `chatStore` | **+ internal action** | `applyServerMessages(roomId, rows)` (additive; public API unchanged). |
| `roomStore` | **+ internal action** | `applyRoomsDelta(rows)` (additive). |
| `useRealtime` | **behavior swap (flagged)** | reconnect → `syncService.syncNow('active-room')`; foreground → `syncNow('rooms')`. |
| `constants.ts` | **+ constants** | `FEATURE_DELTA_SYNC`, `DELTA_SYNC_LIMIT`, backoff constants. |
| Supabase migration | **NEW** | 2 RPCs + optional trigger; RLS-safe (`SECURITY INVOKER`). |

---

## 2. Data flow

### 2.1 Ingest lanes (in order of preference — roadmap §6)

```
1. Realtime push      room:${id} postgres_changes           steady state (UNCHANGED)
2. Delta pull         get_room_messages_since / get_rooms_delta   reconnect / foreground / room-open / pull-refresh (NEW)
3. Page pull          messageService.getMessages(cursor)     history pagination (UNCHANGED)
4. Full pull          get_user_rooms                          first login / gap-overflow fallback (UNCHANGED)
```

### 2.2 Message delta flow (warm room open / reconnect)

```
trigger (reconnect | foreground | room-open | pull-refresh)
   │
   ▼
syncService.syncNow('active-room' | {room})            ── coalesces concurrent calls per scope
   │
   ▼
read cursor  cacheService.getSyncState(roomId).last_synced_at
   │
   ▼
messageService.getRoomMessagesSince(roomId, since, DELTA_SYNC_LIMIT)   ── ordered updated_at ASC, tombstones included
   │
   ├─ rows.length === LIMIT  → GAP OVERFLOW  → fall back to fetchMessages(roomId) [page-1] → mark older history stale
   │
   ▼ (normal)
syncService.applyServerMessages(roomId, rows)
   │
   ├─► cacheService.saveMessages(rows)                 ── SQLite upsert (tombstones update deleted_at)
   ├─► chatStore.applyServerMessages(roomId, rows)     ── patch RAM window ONLY if room resident (dedup + re-sort)
   └─► advance cursor  cacheService.setSyncState(roomId, max(updated_at seen))
```

### 2.3 Room-list delta flow (reconnect / foreground)

```
trigger (reconnect | foreground)
   │
   ▼
syncService.syncNow('rooms')
   │
   ▼
read cursor  cacheService.getSyncState(ROOMS_SCOPE_KEY).last_synced_at    (stored in sync_state, room_id = '@rooms')
   │
   ▼
roomService.getRoomsDelta(userId, since)               ── only rooms whose last_message_at / membership / read state changed
   │
   ├─ empty  → no-op (silent)
   ▼
roomStore.applyRoomsDelta(rows)                        ── upsert changed rooms into RAM list, re-sort (sortRooms)
   │
   ├─► cacheService.saveRooms(current merged list)      ── OR targeted upsert (see §9.2)
   └─► advance cursor  cacheService.setSyncState('@rooms', max(last_message_at/updated_at))
```

> **Membership removal caveat:** `get_rooms_delta` cannot express "you were removed from room X"
> as a changed *row* it returns. Membership deletions therefore keep today's behavior — the
> `room_participants` DELETE realtime event triggers a full `resync()`. `get_rooms_delta` is used
> only for the additive/changed case. This is documented as an accepted boundary (see §12 R4).

---

## 3. Cursor strategy

### 3.1 What the cursor is

Per scope we persist a **high-water mark timestamp**:

| Scope | Cursor key | Cursor value = max of | Server column driving it |
|-------|-----------|------------------------|--------------------------|
| Per room (messages) | `room_id` (the UUID) | `updated_at` across every message row seen for that room | `messages.updated_at` |
| Room list | `'@rooms'` (reserved sentinel) | `last_message_at` / participant `updated_at` seen | derived in `get_rooms_delta` |

`updated_at` is the correct cursor for messages because **INSERT, edit, and recall all bump
`updated_at`** (recall = soft delete sets `deleted_at` *and* bumps `updated_at`). So a single
`updated_at > since` predicate captures new messages, edits, and tombstones in one pass.

### 3.2 Why not `created_at`

`created_at` misses edits/recalls of old messages (their `created_at` is unchanged). `updated_at`
is monotonic per row on every mutation → the only safe delta cursor.

### 3.3 Cursor storage (SQLite migration v2)

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  scope_id       TEXT PRIMARY KEY NOT NULL,   -- room UUID, or '@rooms'
  last_synced_at TEXT,                         -- ISO-8601, max updated_at applied
  has_full_history INTEGER NOT NULL DEFAULT 0, -- 1 = local history is contiguous back to room start
  stale          INTEGER NOT NULL DEFAULT 0,   -- 1 = older history marked stale after gap-overflow
  updated_at     TEXT
);
```

- Lives in the same SQLite file (wiped on logout with everything else — no extra logout wiring).
- `has_full_history` and `stale` support the gap-overflow fallback (§4.4, §5).

### 3.4 Cursor lifecycle rules

1. **Cold room (no cursor):** `last_synced_at IS NULL` → **no delta**; do the normal page-1
   fetch (today's cold path). After that page persists, set the cursor to `max(updated_at)` of
   the page.
2. **Advance only forward:** `setSyncState` writes `max(existing, batch_max)` — never regresses
   (protects against out-of-order batch application).
3. **Clock source:** the cursor value always comes from **server row timestamps**, never the
   device clock. Client clock skew therefore cannot corrupt the cursor.
4. **Overlap-inclusive queries:** RPC uses `updated_at > since` (strict) but the client tolerates
   receiving a row it already has (upsert is idempotent). We use strict `>` to avoid re-pulling
   the boundary row every time; the merge is idempotent regardless.

---

## 4. Merge algorithm

`syncService.applyServerMessages(roomId, rows)` — pure function over (existing window, batch):

### 4.1 Preconditions

- `rows` are server rows ordered `updated_at ASC`, may include tombstones (`deleted_at != null`).
- Batch already passed the gap-overflow check (§4.4), i.e. `rows.length < DELTA_SYNC_LIMIT`.

### 4.2 SQLite write (always, even if room not resident in RAM)

```
cacheService.saveMessages(rows)        // INSERT OR REPLACE by id (existing repo.upsertMany)
```

- Tombstones (soft delete) are just rows with `deleted_at` set → upsert overwrites the cached
  row, so the recall is persisted. No special path.
- `temp-` ids can never appear in server rows, so the existing `isPersistable` filter is a no-op
  safety net here.

### 4.3 RAM window patch (only if `chatStore.messages[roomId]` is resident)

```
current = state.messages[roomId] ?? []            // if room evicted/never-opened → skip RAM, SQLite already updated
byId    = Map(current.map(m => [m.id, m]))
for row in rows:
    existing = byId.get(row.id)
    if existing:
        byId.set(row.id, mergeRow(existing, row))   // edit / recall / tombstone
    else:
        byId.set(row.id, row)                        // new message missed while offline
merged = [...byId.values()]
sort merged by created_at DESC   (reuse the timeById one-parse sort from fetchMessages)
enforce window cap (MESSAGE_WINDOW_SIZE / TRIM_SIZE — identical to addMessage rule)
set state.messages[roomId] = merged
```

`mergeRow(existing, server)`:

```
{
  ...server,                          // server wins on content, is_edited, deleted_at, pinned_*
  message_reactions: existing.message_reactions,   // PRESERVE local embeds (same rule as updateMessage)
  poll_votes:        existing.poll_votes,          // realtime is the live path for these
}
```

> This is exactly the existing `chatStore.updateMessage` merge rule, generalized to a batch.
> Reactions/votes embeds are preserved because the delta RPC does **not** re-embed them
> (`SELECT *` only) — the live `postgres_changes` path keeps them current, and the optional
> `touch_message_on_reaction` trigger (§7.4) makes offline reaction changes reconcile on the
> next **page fetch** (documented limitation, not a regression vs today).

### 4.4 Gap-overflow guard (before applying)

```
if rows.length >= DELTA_SYNC_LIMIT:                 // delta too big → treat as "history diverged"
    syncState.stale = 1                             // mark older history stale
    syncState.has_full_history = 0
    fetchMessages(roomId)                           // today's page-1 path (replaces newest window)
    // cursor advances from the page-1 result, not from the truncated delta
    return
```

`DELTA_SYNC_LIMIT` (new constant, default **200**, matches roadmap §13). The point: a delta that
hits the limit means we can't guarantee contiguity, so we degrade gracefully to the known-good
full-page path rather than stitching a possibly-gapped window.

### 4.5 Hard-delete (undo-send) reconciliation

Soft deletes (recall) arrive as tombstone rows and are handled by upsert. **Hard deletes**
(undo-send within 8 s) do not produce a delta row (the row is gone), so a client that was offline
during the window would keep a ghost. Rule (roadmap §13):

```
after applying a delta with cursor `since`:
  candidates = local messages in room with created_at > since AND age < UNDO_SEND_WINDOW_MS*2
  for each candidate NOT present in the returned delta ids:
      verify existence: messageService.getMessages returns it? (cheap, bounded set)
      if absent server-side → removeMessage(id) + cacheService.deleteMessage(id)
```

In practice the set is tiny (only very recent messages) and usually empty. This runs only on the
delta path, not steady state.

---

## 5. Conflict handling

| Conflict | Resolution | Rationale |
|----------|-----------|-----------|
| **Content edit** local optimistic vs server | Server wins (last-write-wins by `updated_at`); `mergeRow` overwrites content. | Edits are already server-confirmed before they matter; no offline edit exists (no outbox in this phase). |
| **Reaction / vote embeds** | Local embeds preserved on merge; live path (`postgres_changes`) is authoritative. | Delta RPC doesn't re-embed; avoids blanking reactions on every reconnect. |
| **Recall (soft delete) missed while offline** | Tombstone row upserts → renders as recalled bubble. | `deleted_at` bump makes it delta-visible. |
| **Hard delete missed while offline** | §4.5 reconciliation drops the ghost. | Only affects <16 s-old messages. |
| **Same message via realtime AND delta simultaneously** | Idempotent: both go through store mutators keyed by `id`; upsert + `some(m.id===)` dedup. | No duplicate ids possible. |
| **Optimistic send in flight during a delta** | Cursor merge keys by `id`; `temp-` ids never collide with server ids; `replaceOptimisticMessage` still runs. | Phase-3 race handling unchanged. |
| **Two cursors racing (concurrent syncNow same scope)** | Coalesced (§6.1) — only one in-flight per scope; the other awaits the same promise. | Prevents double-advance / interleave. |
| **Cursor regression from out-of-order apply** | `setSyncState` takes `max()` (§3.4). | Monotonic cursor. |
| **Room removed from membership** | Full `resync()` on `room_participants` DELETE (today's path). | Delta can't represent absence. |

---

## 6. Retry policy

### 6.1 Coalescing (dedup)

`syncService` keeps an in-flight map keyed by scope:

```
inFlight: Map<scopeKey, Promise<void>>
scopeKey = 'rooms' | `room:${roomId}`
syncNow(scope):
    if inFlight.has(key): return inFlight.get(key)     // ride the existing pull
    p = doSync(scope).finally(() => inFlight.delete(key))
    inFlight.set(key, p); return p
```

This mirrors the existing `chatStore.inFlightFetches` design (keyed dedup, only concurrent calls
coalesce; a completed sync never blocks a fresh one).

### 6.2 Backoff on failure

Delta RPC failure (network / 5xx) uses bounded exponential backoff, **but never blocks the UI**:

```
DELTA_RETRY_BASE_MS   = 2000
DELTA_RETRY_MAX_MS    = 30000
DELTA_MAX_ATTEMPTS    = 4
attempt n delay = min(BASE * 2^(n-1), MAX)   → 2s, 4s, 8s, 16s(capped 30s)
```

- Retries are per scope and cancel if a newer `syncNow(sameScope)` supersedes them.
- After `DELTA_MAX_ATTEMPTS` → **fall back to today's behavior** for that scope
  (`fetchMessages` page-1 / `fetchRooms` full) exactly once, then give up until the next trigger.
  This guarantees Phase 4 is never *worse* than today on the failure path.
- No retry storm: retries only exist while the app is foregrounded and the scope is still
  relevant (active room still open / rooms tab still mounted).

### 6.3 What is NOT retried

Non-durable, last-write-wins signals (typing, presence, read watermark) are **not** part of delta
sync and are not queued/retried — reconnect naturally re-establishes them (unchanged).

---

## 7. Database interaction

### 7.1 New RPC — `get_room_messages_since`

```sql
CREATE OR REPLACE FUNCTION get_room_messages_since(
  p_room_id uuid,
  p_since   timestamptz,
  p_limit   int DEFAULT 200
)
RETURNS SETOF messages
LANGUAGE sql
SECURITY INVOKER               -- runs as caller → existing RLS on messages applies unchanged
STABLE
AS $$
  SELECT *
  FROM messages
  WHERE room_id = p_room_id
    AND updated_at > p_since
  ORDER BY updated_at ASC
  LIMIT p_limit;
$$;
```

- `SECURITY INVOKER` + existing `messages` RLS = a user can only pull rooms they participate in
  (no new attack surface; roadmap R-privacy).
- Returns `SETOF messages` → the client re-uses the existing row→domain mapping. Reactions/votes
  are **not** embedded here (kept live via realtime), matching §4.3.
- Index: existing `messages(room_id, created_at)` is insufficient; add
  `CREATE INDEX idx_messages_room_updated ON messages (room_id, updated_at);` (server-side).

### 7.2 New RPC — `get_rooms_delta`

```sql
CREATE OR REPLACE FUNCTION get_rooms_delta(
  p_user_id uuid,
  p_since   timestamptz
)
RETURNS TABLE (<same columns as get_user_rooms>)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  -- identical projection to get_user_rooms, plus a WHERE that limits to rooms
  -- whose last_message_at OR the caller's participant row changed since p_since
  ...
  WHERE p.user_id = p_user_id
    AND (r.last_message_at > p_since OR p.updated_at > p_since)
$$;
```

- Same row shape as `get_user_rooms` → reuses `RoomWithLastMessage` and existing repo/store
  mapping. **No pagination change.**
- Full `get_user_rooms` remains for first login and the fallback path.

### 7.3 Client SQLite migration v2

```sql
-- src/db/migrations.ts : MIGRATION_002_SYNC_STATE (append-only, toVersion = 2)
CREATE TABLE IF NOT EXISTS sync_state ( ... );   -- see §3.3
```

Applied automatically by the existing `runMigrations` framework
([migrations.ts](file:///Users/dabeeovina/Documents/TL-chatting/src/db/migrations.ts)); no other
wiring. A user upgrading from Phase 3 gets `user_version 1 → 2` transactionally.

### 7.4 Optional trigger — `touch_message_on_reaction`

```sql
-- bumps messages.updated_at when a reaction/vote row changes, so reaction
-- changes become delta-visible. FLAG-OPTIONAL: ship only if reaction-while-
-- offline reconciliation proves necessary. Without it, reactions reconcile on
-- the next page fetch (documented, acceptable).
```

### 7.5 Type regeneration

Per the standard workflow (AGENTS.md): after applying the server migration,
`npx supabase gen types typescript --project-id <id> > src/types/database.ts`; extend domain
aliases in `src/types/index.ts` only if a new returned shape appears (it does not — both RPCs
reuse existing shapes). **Never hand-edit `database.ts`.**

---

## 8. Repository responsibilities

### 8.1 New `SyncStateRepository` (interface in `repositories/types.ts`)

```
interface SyncStateRepository {
  get(scopeId: string): Promise<SyncState | null>;
  set(scopeId: string, patch: Partial<SyncState>): Promise<void>;   // upsert, max()-guards last_synced_at
  clear(): Promise<void>;                                            // parity with other repos (logout wipe covers it)
}
```

- Pure row↔domain mapping over the `sync_state` table; no business logic.
- Added to the `Repositories` bundle in `repositories/sqlite.ts` and `createRepositories`.

### 8.2 Existing repositories — reused unchanged

| Repo | Method used by Phase 4 | Change? |
|------|------------------------|---------|
| `MessageRepository` | `upsertMany` (delta apply), `getPageByRoom` (hydrate), `deleteById` (hard-delete reconcile), `pruneRoom` (cap disk history to `MAX_PERSISTED_PER_ROOM`) | none — Phase 3 surface is sufficient |
| `RoomRepository` | `upsertMany` (rooms-delta apply), `replaceAll` (full fallback), `getAll` (hydrate) | none |

> **Repositories stay dumb.** No repo knows what a "cursor" or "delta" is except
> `SyncStateRepository`, which only stores/reads a timestamp. All merge/coalesce/retry logic
> lives in `syncService`. This keeps the storage engine swappable (roadmap principle).

---

## 9. Store responsibilities

### 9.1 `chatStore` (additive; public API preserved)

- **New internal action** `applyServerMessages(roomId, rows)` implementing §4.3 (patch resident
  window only; skip RAM if room not resident — SQLite already written by syncService).
- `fetchMessages`, `loadMore`, `addMessage`, `updateMessage`, `removeMessage`, selectors:
  **unchanged**. Screens/components see no API difference.
- The window-cap logic in `applyServerMessages` reuses the exact `MESSAGE_WINDOW_SIZE` /
  `ROOM_CACHE_TRIM_SIZE` rule already in `addMessage`.

### 9.2 `roomStore` (additive)

- **New internal action** `applyRoomsDelta(rows)`: upsert changed rooms into `rooms`, re-sort via
  existing `sortRooms`, then persist. Persist strategy: targeted `cacheService.saveRooms(mergedList)`
  (simplest, reuses `replaceAll`) — acceptable because the list is small (≤ tens of rooms).
- `fetchRooms` hydrate-first + write-through: **unchanged**.

### 9.3 What stores do NOT do

- Stores never call RPCs directly and never read/write `sync_state`. They expose mutators that
  `syncService` calls. This keeps the store a pure render-state container (Zustand rule from
  memory: select individual fields, no side-effect sprawl).

---

## 10. Public API changes

### 10.1 Screens / components / hooks — **no breaking changes**

`useMessages(roomId)` and `useRooms()` return the same shape. `MessageList` / room list props
unchanged. No screen edits required for correctness (only `useRealtime` internals change).

### 10.2 New internal surfaces (not consumed by UI)

| Surface | Signature | Consumer |
|---------|-----------|----------|
| `syncService.syncNow(scope)` | `(scope: SyncScope) => Promise<void>` where `SyncScope = 'rooms' \| { room: string } \| 'active-room'` | `useRealtime`, room-open effect, pull-to-refresh |
| `syncService.applyServerMessages(roomId, rows)` | internal merge (exported for tests) | `syncService` (self), tests |
| `chatStore.applyServerMessages` | `(roomId, rows) => void` | `syncService` |
| `roomStore.applyRoomsDelta` | `(rows) => void` | `syncService` |
| `cacheService.getSyncState / setSyncState` | never-throw wrappers | `syncService` |
| `messageService.getRoomMessagesSince` / `roomService.getRoomsDelta` | RPC wrappers | `syncService` |

### 10.3 Constants (`src/lib/constants.ts`)

```
FEATURE_DELTA_SYNC        = false   // master flag — off = identical to today
DELTA_SYNC_LIMIT          = 200
MAX_PERSISTED_PER_ROOM    = 1000    // disk prune cap (roadmap §7)
DELTA_RETRY_BASE_MS       = 2000
DELTA_RETRY_MAX_MS        = 30000
DELTA_MAX_ATTEMPTS        = 4
```

### 10.4 Flag semantics

`FEATURE_DELTA_SYNC = false` ⇒ `syncService.syncNow` is a **no-op that delegates to the legacy
path** (reconnect → `fetchMessages`; foreground → `fetchRooms`). The wiring in `useRealtime`
always calls `syncService`; the flag decides *inside* the service. This guarantees the flag-off
path is byte-equivalent to today and rollback is a one-line change.

---

## 11. Sequence diagrams

### 11.1 Reconnect after 30 s offline (active room) — happy path

```
Realtime        useRealtime         syncService        cacheService/SQLite     messageService/Supabase       chatStore
   │ CHANNEL_ERROR │                     │                     │                        │                        │
   │──────────────►│ hadDrop=true        │                     │                        │                        │
   │  ... 3s ...   │ scheduleReconnect    │                     │                        │                        │
   │ SUBSCRIBED    │                     │                     │                        │                        │
   │──────────────►│ syncNow('active-room')                    │                        │                        │
   │               │────────────────────►│ getSyncState(room)  │                        │                        │
   │               │                     │────────────────────►│ last_synced_at=T0      │                        │
   │               │                     │◄────────────────────│                        │                        │
   │               │                     │ getRoomMessagesSince(room, T0, 200)           │                        │
   │               │                     │──────────────────────────────────────────────►│  3 rows (updated>T0)  │
   │               │                     │◄──────────────────────────────────────────────│                        │
   │               │                     │ rows.length(3) < LIMIT → apply                │                        │
   │               │                     │ saveMessages(rows) ─────────►│ upsert         │                        │
   │               │                     │ applyServerMessages(room, rows)───────────────────────────────────────►│ patch window (dedup+sort)
   │               │                     │ setSyncState(room, max(updated_at))──────────►│ T1                     │
   │               │                     │◄── done (no page-1 fetch in network log) ✔    │                        │
```

### 11.2 Gap overflow (missed > 200 messages) — fallback

```
syncService                messageService              chatStore/cacheService
   │ getRoomMessagesSince(room, T0, 200)  │                       │
   │─────────────────────────────────────►│ returns 200 rows      │
   │◄─────────────────────────────────────│                       │
   │ rows.length == LIMIT → GAP           │                       │
   │ setSyncState(room, {stale:1, has_full_history:0})────────────►│
   │ fetchMessages(room)  [legacy page-1] │                       │
   │─────────────────────────────────────►│ getMessages(room)     │
   │◄─────────────────────────────────────│ 20 rows               │
   │ (fetchMessages already write-through + patch window)────────►│ replaceNewestWindow + window
   │ cursor advances from page-1 max(updated_at)                  │
```

### 11.3 Foreground → room-list delta

```
AppState 'active'   useRealtime        syncService         roomService/Supabase      roomStore/cacheService
   │───────────────►│ syncNow('rooms')  │                        │                        │
   │                │──────────────────►│ getSyncState('@rooms') → R0                     │
   │                │                   │ getRoomsDelta(userId, R0)                        │
   │                │                   │───────────────────────►│ 2 changed rooms         │
   │                │                   │◄───────────────────────│                         │
   │                │                   │ applyRoomsDelta(rows)──────────────────────────►│ upsert + sortRooms
   │                │                   │ setSyncState('@rooms', max)─────────────────────►│ R1
   │                │                   │◄── done (payload ≪ full get_user_rooms) ✔        │
```

### 11.4 Flag OFF (rollback) — identical to today

```
useRealtime         syncService
   │ SUBSCRIBED(hadDrop) │
   │────────────────────►│ syncNow('active-room')
   │                     │ FEATURE_DELTA_SYNC === false
   │                     │ → chatStore.fetchMessages(room)   // legacy page-1, unchanged
   │◄────────────────────│
```

---

## 12. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | SQLite / RAM / server divergence (3 copies of truth) | Med | High | Single merge path (`applyServerMessages`); SQLite droppable (logout wipe + schema-version bump); any suspected corruption → gap-overflow → page-1 rebuild. |
| R2 | Cursor stuck / never advances → deltas grow unbounded | Low | High | `max()`-guarded monotonic advance; gap-overflow at `DELTA_SYNC_LIMIT` forces page-1 + cursor reset; `stale` flag. |
| R3 | `updated_at` not bumped on some server mutation | Low | Med | Audit triggers; DB `updated_at` is set on all message writes today; recall/edit already bump it; add `touch_message_on_reaction` if reactions matter offline. |
| R4 | Membership removal invisible to `get_rooms_delta` | Med | Low | Keep the existing `room_participants` DELETE → full `resync()` path; delta covers only additive/changed rooms. |
| R5 | Reaction/vote embeds blanked by delta | Low | Med | `mergeRow` preserves local embeds; live path authoritative; optional trigger. |
| R6 | RLS bypass via new RPCs | Low | High | `SECURITY INVOKER` + existing RLS; no `service_role`; reviewed in migration. |
| R7 | Retry storm on persistent RPC error | Low | Med | Bounded attempts (`DELTA_MAX_ATTEMPTS`), per-scope coalescing, fallback-once-then-stop. |
| R8 | Flag-off path drifts from "today" | Low | High | Flag decision lives *inside* syncService delegating to the exact legacy calls; covered by a regression test (§14). |

---

## 13. Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| **Sequence-number cursor (per-room monotonic counter)** | Requires a new server column + backfill + trigger; `updated_at` already exists and is monotonic per row. Revisit only if timestamp collisions at ms resolution cause missed rows (mitigated by strict `>` + idempotent upsert). |
| **Route realtime through `applyServerMessages` now (full single-writer)** | Larger blast radius; violates "don't change steady-state realtime." Deferred — the shared store mutators already give consistency. |
| **Reuse the `meta` table for cursors** | `meta` is a generic KV; a typed `sync_state` table gives per-room rows, indexing, and the `has_full_history`/`stale` flags without JSON gymnastics. |
| **WebSocket replication / logical decoding stream** | Massive infra; overkill for chat-scale deltas; Supabase Realtime already covers steady state. |
| **Client-side "diff by fetching page-1 and comparing"** | That *is* today's cost — defeats the purpose. |
| **Server push of deltas (C2 per-user broadcast)** | That is the *next* phase (C2) and depends on this one as the resync fallback. Delta-pull first, push later. |
| **Store cursor in Zustand (RAM) only** | Lost on cold start → every launch is a full pull. Must be persistent → SQLite. |

---

## 14. Rollout strategy

1. **Ship dormant.** Land server migration (RPCs + index + optional trigger) and client code with
   `FEATURE_DELTA_SYNC = false`. Behavior byte-identical to today. `sync_state` table created but
   cursors simply never read on the legacy path.
2. **Internal dogfood.** Flip the flag locally / on a dev build. Validate the success criteria
   (§0 roadmap C1) with the network inspector: reconnect shows **only** the delta RPC, no page-1.
3. **Staged enable.** Because the flag is a client constant, enable via a build/OTA to a small
   cohort; monitor `get_logs` for RPC errors and client `console.error("[syncService] …")`.
4. **Full enable.** Flip default to `true`.
5. **Kill switch.** Any regression → set `FEATURE_DELTA_SYNC = false` (one-line) → instant revert
   to the proven full-refetch path. No data migration needed (SQLite is a cache).
6. **Cache-version safety.** If a `sync_state`/schema issue is found post-release, bump
   `LATEST_SCHEMA_VERSION` (or the documented `CACHE_SCHEMA_VERSION` kill-switch) → next launch
   wipes every client's SQLite and rebuilds cold. Server remains the source of truth.
7. **C2 dependency note.** Leave `get_user_rooms` and `global:messages` intact — C2 (per-user
   broadcast) will run in parallel with them for one release before anything is deleted (roadmap R2).

---

## 15. Test strategy

### 15.1 Unit — merge algorithm (pure, no DB)

- `applyServerMessages`: new rows inserted & sorted DESC by `created_at`.
- Edit row → content replaced, `message_reactions`/`poll_votes` preserved.
- Tombstone row → `deleted_at` set, renders as recalled.
- Duplicate id (realtime already delivered) → no duplicate, single merged row.
- Window cap enforced identically to `addMessage` (active vs inactive room caps).
- Room not resident in RAM → merge is a no-op on the store (SQLite still written — asserted via mock).

### 15.2 Unit — cursor

- Cold room (`last_synced_at = null`) → legacy page-1, cursor set from page max.
- `setSyncState` monotonic: applying an older batch never regresses the cursor.
- Gap overflow (`rows.length === LIMIT`) → `stale=1`, `has_full_history=0`, page-1 fallback invoked.

### 15.3 Unit — coalescing & retry

- Two concurrent `syncNow('room:X')` → single RPC call (in-flight map), both resolve.
- RPC rejects N times → backoff sequence 2s/4s/8s/16s; after `DELTA_MAX_ATTEMPTS` → single legacy
  fallback, then stop.
- A newer `syncNow(sameScope)` cancels pending retries.

### 15.4 Integration (SQLite, native/dev-client)

- Seed cache, advance cursor, apply a delta batch → SQLite rows + cursor correct.
- Hard-delete reconciliation drops a ghost message absent from the delta.
- Migration v1→v2 upgrade on an existing Phase-3 DB (no data loss, `sync_state` created).

### 15.5 End-to-end (manual, matches roadmap success criteria)

- [ ] Kill network 30 s while another device sends 3 messages → reconnect → **only** the delta RPC
      in the network log, 3 messages appear.
- [ ] Another device edits + recalls while offline → reconcile correctly on next delta.
- [ ] Force >200 missed messages → page-1 fallback, older history marked stale, no corruption.
- [ ] Foreground room-list resync payload measurably smaller than full `get_user_rooms` (recorded).
- [ ] **Flag OFF** → reconnect/foreground behavior byte-identical to today (regression guard R8).
- [ ] Web (no SQLite): `cacheService` no-op → delta path degrades to legacy fetch, no crash.

### 15.6 Non-functional

- Network-traffic comparison (delta vs full) recorded before/after per §0.
- No new dependency in `package.json` (CI check).
- `npx tsc --noEmit` clean; `src/db/*` still imported only by `databaseService`/`cacheService`
  (layering grep guard, same as Phase 2/3).

---

## 16. Implementation checklist (Phase 4 build order)

1. `constants.ts`: add flag + tuning constants (§10.3).
2. Server migration: `get_room_messages_since`, `get_rooms_delta`, `idx_messages_room_updated`,
   optional trigger; apply; regenerate `database.ts`.
3. Client migration v2: `sync_state` table (append-only in `migrations.ts`).
4. `SyncStateRepository` interface + SQLite impl + add to `createRepositories`.
5. `cacheService`: `getSyncState` / `setSyncState` (never-throw).
6. `messageService.getRoomMessagesSince`, `roomService.getRoomsDelta`.
7. `chatStore.applyServerMessages`, `roomStore.applyRoomsDelta` (additive).
8. `syncService.ts`: cursors, coalescing, retry, merge, gap-overflow, flag delegation.
9. `useRealtime`: swap reconnect/foreground recovery calls to `syncService.syncNow` (flag-gated).
10. Room-open + pull-to-refresh triggers → `syncNow`.
11. Tests (§15); dogfood with flag on.

> Every step is additive or flag-gated; at no point between steps is the app in a worse state than
> Phase 3, and step 11 flips nothing until the flag is set.

---

## 17. Design corrections (Phase 4B — incorporated before implementation)

Grounding the design against the *actual* database and the 9 non-negotiable invariants surfaced
four issues. Per the rule "if implementation reveals an architectural issue, STOP and update the
design document," they are corrected here; the sections above remain the conceptual reference and
are superseded by this section where they conflict.

### C1 — `messages.updated_at` is NOT bumped on recall (and edit uses the client clock) — **critical**

Evidence in the live schema/code:
- `messages.updated_at` is `TIMESTAMPTZ DEFAULT now()` — set on **INSERT only**; there is **no**
  `BEFORE UPDATE` trigger maintaining it (`00001`, `00008`).
- `messageService.deleteForEveryone` (recall) issues an UPDATE that sets `deleted_at` but **never
  touches `updated_at`** → a recall missed while offline would be **invisible** to a
  `updated_at > since` delta. The cursor is provably broken.
- `messageService.updateMessage` (edit) sets `updated_at = new Date().toISOString()` — the **client
  clock**, violating Invariant #4 ("server is the only authority for sync timestamps").

**Correction (required migration):** add a server-side `set_updated_at()` `BEFORE UPDATE` trigger on
`public.messages` that unconditionally sets `NEW.updated_at = now()`. This makes INSERT/edit/recall/
pin all advance `updated_at` from the **server clock**, restoring the cursor and satisfying
Invariant #4. The existing `messages_block_update_after_delete` trigger is unaffected (independent
`BEFORE UPDATE` trigger; if it raises, the whole statement aborts regardless of ordering). The
client's manual `updated_at` in `updateMessage` becomes a harmless no-op (the trigger overrides it);
left in place to keep the diff minimal.

### C2 — Reaction/vote changes must advance the cursor (Invariant #5)

Reactions/votes live in separate tables; changing them does **not** touch `messages.updated_at`, so
a pure reaction change is invisible to the messages delta. To satisfy Invariant #5 ("every
user-visible mutation must advance the synchronization cursor"), the previously *optional*
`touch_message_on_reaction` trigger becomes **required**: on `message_reactions`
INSERT/DELETE and `poll_votes` INSERT/UPDATE/DELETE it runs
`UPDATE public.messages SET updated_at = now() WHERE id = <message_id> AND deleted_at IS NULL`.
The `deleted_at IS NULL` guard means the touch never targets a recalled row, so it can never trip
`block_update_after_delete`. Tradeoff (accepted, documented): each reaction/vote emits one extra
`messages` UPDATE realtime event, handled idempotently by the existing `updateMessage` path (embeds
preserved) — no visible change.

### C3 — Messages delta is a PostgREST select, not a new RPC

`get_room_messages_since` as a `RETURNS SETOF messages` RPC would **drop the reactions/votes
embeds** that `getMessages` returns, and would force a `database.ts` regeneration. Correction: the
messages delta is a plain PostgREST query reusing the existing embed select —
`from("messages").select(MESSAGE_WITH_META_SELECT).eq("room_id",…).gt("updated_at", since)
.order("updated_at", { ascending: true }).limit(DELTA_SYNC_LIMIT)`. This is RLS-enforced identically
to `getMessages`, returns embeds (so brand-new delta messages arrive complete), and needs **no type
regeneration**. Only `get_rooms_delta` remains an RPC (complex aggregation reusing `get_user_rooms`
shape) and is the sole item requiring a manual `database.ts` regen. `get_rooms_delta` mirrors
`get_user_rooms` (`SECURITY DEFINER`, same return columns) with an added
`AND (r.<activity> > p_since OR rp.<membership> > p_since)` predicate.

### C4 — Merge logic is owned by the repository layer (Invariant #3)

§4/§8.2/§9.1 placed the batch merge in `syncService`/`chatStore` ("repositories stay dumb"). This
contradicts Invariant #3 ("Repository owns all merge logic"). **Correction:** the pure, idempotent
batch-merge of server rows into an existing window (dedup by `id`, preserve local reaction/vote
embeds, sort `created_at` DESC, window-cap) lives in the **repository layer** as a pure function
(`src/db/repositories/merge.ts`, exported as `mergeMessageWindow`), and SQLite persistence stays the
idempotent `upsertMany`. `cacheService` exposes it (`mergeMessages`) to the service layer;
`syncService` orchestrates (read resident window → repo merge → write store via a plain
`chatStore.setRoomMessages` setter → persist). The store keeps a dumb setter (no merge logic);
`syncService` never blocks rendering (fire-and-forget SQLite, synchronous RAM patch). The Phase-3
realtime single-append path (`addMessage`) is out of scope and unchanged (constraint: no unrelated
refactoring) — Invariant #3 governs the **sync-batch** merge introduced by this phase.

### C5 — Cursor advancement is centralized in `cacheService` (Invariant #5)

Rather than advancing the cursor only on the delta/page paths, `cacheService.saveMessages` /
`saveMessagePage` advance the per-room cursor centrally: group persisted rows by `room_id`, take
`max(updated_at)`, and `setSyncState(room, max)` (monotonic). Because **every** ingest point
(realtime add/update, confirmed send, delta apply, page fetch) already funnels through these two
write-through methods (Phase 3), this single change makes every user-visible mutation advance the
cursor with no per-call-site wiring — satisfying Invariant #5 for messages. The `'@rooms'` list
cursor is advanced explicitly by `roomStore` write-through (`saveRooms`).

### Revised type-regeneration surface

Only `get_rooms_delta` requires `npx supabase gen types … > src/types/database.ts`. Until then the
client wrapper types the call through a localized cast (documented in `roomService`). All other
Phase 4B work needs no schema-type change.

### C6 — "Warm" = resident in RAM, not merely "has a cursor" (Invariants #8/#9)

§3.4 rule 1 defined *cold* as "no cursor". But `applyServerMessages` patches the RAM window **only
when the room is resident** (`chatStore.messages[roomId]` present) — a delta on a non-resident room
persists to SQLite but paints nothing. A room can hold a persisted cursor from a previous session
yet not be resident after a cold launch or LRU eviction. Routing a listed delta trigger (§2.1 —
room-open) through a pure delta in that state would show an empty room. **Correction:** `syncRoom`
takes the legacy page fetch when the room is **not resident OR has no cursor**, and only runs the
delta for a resident room with a cursor — exactly Invariant #8 ("cold rooms use page fetch") /
Invariant #9 ("warm rooms use incremental sync"), with *warm ≡ resident*. The page fetch paints,
hydrates from SQLite, and (re-)seeds the cursor via write-through, so the next sync of a now-warm
room is a true delta. This also lets `useMessages` route room-open through `syncNow({ room })`
safely: first open → page fetch, same-session revisit → delta.


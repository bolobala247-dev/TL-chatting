# Talo — Telegram-Style Chat Performance Upgrade Roadmap

> **Status:** Blueprint only — no code has been changed. This document is the implementation
> contract for all future performance phases.
>
> **Grounding:** Every "current state" claim below is verified against the repository as of this
> writing (`src/stores/chatStore.ts`, `src/hooks/useMessages.ts`, `src/hooks/useRealtime.ts`,
> `src/services/messageService.ts`, `src/components/chat/MessageList.tsx`,
> `docs/project-context/05-chat-architecture.md`, `docs/project-context/07-performance.md`).

---

## 1. Current Architecture Summary

### Layering (unchanged one-way flow)

```
app/chat/[roomId].tsx  (ChatScreen)
   ├─ useMessages(roomId)         → chatStore + messageService + useRealtimeMessages
   ├─ useRoomParticipants(roomId) → chatStore.participantsByRoom
   ├─ useTypingIndicator(roomId)  → Supabase Presence channel typing:${roomId}
   ├─ usePeerPresence(peerId)     → get_peer_profile RPC polled every 30 s (DMs)
   └─ MessageList (FlashList v2) → MessageBubble (memoized)

app/(tabs)/index.tsx (room list, FlatList)
   └─ useRooms → roomStore → get_user_rooms RPC
useRealtimeRooms() mounted once at root → channel global:messages (UNFILTERED)
```

### Key facts

| Aspect | Current state |
|--------|---------------|
| Server cache | None (no React Query/SWR); manual Zustand |
| Message store | `chatStore.messages: Record<roomId, MessageWithMeta[]>` — RAM only, newest-first |
| Pagination | Cursor on `created_at`, `MESSAGES_PER_PAGE = 20`, FlashList `onStartReached` @ 0.2 |
| Persistence | Drafts + recent emojis + theme/language only (AsyncStorage). **Zero message persistence** |
| Offline | None: no connectivity detection, no outbox; offline send fails and evicts the optimistic bubble |
| Realtime (room) | `room:${roomId}` postgres_changes on 4 tables, filtered by room |
| Realtime (global) | `global:messages` — `messages` INSERT **with no filter** (every client sees every message in the system) |
| Reconnect recovery | Refetch first page (room) / full `get_user_rooms` resync (list). No gap-fill |
| Send path | Optimistic temp-ID → PostgREST INSERT → replace; race-safe against realtime echo; 8 s undo window |
| Images | Originals uploaded (picker quality 0.8) in parallel to public `chat-media`; rendered via `expo-image` `memory-disk` |
| Prefetching | **None** anywhere in `src/` |
| Scroll | Bottom-up via `maintainVisibleContentPosition` + `startRenderingFromBottom`; position preserved during pagination only; reopening a room always starts at the bottom; no scroll-to-message |
| Eviction | None — memory grows with every room visited in a session |
| Loading state | Single shared `chatStore.loading` boolean across all rooms |

---

## 2. Current Bottlenecks

Ranked by user-perceived impact × scaling risk:

| # | Bottleneck | Evidence | Impact |
|---|-----------|----------|--------|
| B1 | **Unfiltered `global:messages` channel** — O(total system messages) traffic per client; every client wakes up for every message | `useRealtime.ts` L319–331; flagged in `PRODUCTION_CHECKLIST.md` as the scaling ceiling | Battery, bandwidth, Realtime quota; hard cap on user growth |
| B2 | **Cold start = blank app** — no persisted messages/rooms; everything refetched over the network before first paint of content | `chatStore.ts` (RAM only) | Perceived slowness vs Telegram's instant history |
| B3 | **Room open latency** — every open awaits a network round-trip for page 1 even for rooms visited seconds ago (first page is refetched on mount) | `useMessages.ts` L38–64 | Visible spinner/blank flash on room switch |
| B4 | **No offline mode** — sends fail hard offline; no queue, no retry | `useMessages.ts` L113–115 | Message loss UX; unusable on flaky mobile networks |
| B5 | **Full refetch on reconnect** — no delta/gap-fill; a 1-second WebSocket blip costs a full page fetch + full room-list RPC | `useRealtime.ts` L238–247, L402–411 | Server load spikes on mass reconnect; janky recovery |
| B6 | **Unbounded in-memory cache** — no eviction across visited rooms | `chatStore.ts` | OOM risk on long sessions / low-end Android |
| B7 | **Shared `loading` flag** — concurrent fetches across rooms corrupt loading state; `loadMore` guard reads the *global* flag | `chatStore.ts` L51, `useMessages.ts` L301 | Wrong spinners; blocked pagination when another room is fetching |
| B8 | **Original-size images** — no client resize, no thumbnails, no placeholders; full-res downloads block bubble render | `messageService.ts` album path | Slow media rooms; data usage |
| B9 | **Sender-name N+1** on room-list previews (LRU-mitigated but still 1 query per unknown sender) | `useRealtime.ts` L23–56 | Latency on preview updates in busy accounts |
| B10 | **Peer presence polling** every 30 s per open DM | `usePresence.ts`, `PEER_PRESENCE_POLL_MS` | Query load; up to 30 s stale presence |
| B11 | **`get_user_rooms` scans message history** per room for unread counts | `NOTIFICATION_AUDIT.md` | Room-list RPC gets slower as history grows |
| B12 | **Page size 20** forces rapid successive pagination fetches when scrolling history | `constants.ts` L1 | Scroll hitches during history reading |
| B13 | **No `getItemType` / mixed recycling pool** on the chat FlashList | `MessageList.tsx` | Recycling churn between text/album/poll bubbles |
| B14 | **Room list still FlatList** (migration leftover) | `app/(tabs)/index.tsx` | Slower list at scale |

---

## 3. UX Comparison with Telegram / Messenger / Discord

| Behavior | Telegram | Messenger | Discord | **Talo today** |
|----------|----------|-----------|---------|----------------|
| Cold start | Instant history from local DB; syncs deltas in background | Instant from local cache | Recent channels cached | Blank → spinner → network fetch |
| Room open | Instant (0 ms perceived, local-first render) | Instant | Near-instant | Cache render if visited this session, but still refetches page 1; blank on first visit |
| Room switch back/forth | Instant, scroll position restored to last-read | Instant, bottom | Restores position per channel | Re-render from RAM cache + refetch; always jumps to bottom |
| Offline send | Queued with clock icon, auto-sends on reconnect | Queued | Queued, retries | **Fails and disappears** |
| Offline read | Full history readable | Recent history | Recent | Nothing after cold start |
| Reconnect | Delta sync (`updates.getDifference`) — only missed events | Delta sync | Gateway resume + replay | Full page/list refetch |
| Images | Progressive: inline blurred thumbnail → full image; sizes negotiated | Progressive thumbnails | Resized variants per context | Full-res original or nothing |
| Scroll to reply/pinned | Jump anywhere in history | Jump to message | Jump to message | Not supported |
| History scroll | Butter-smooth, ~50-item chunks, bidirectional | Smooth | Smooth with jump gaps | 20-item pages, frequent fetch pauses |
| New-message badge while scrolled up | Floating "N new messages" pill | Pill | "New messages" bar | Auto-scroll threshold only |
| Presence/typing | Push-based, instant | Push | Push (gateway) | Typing push-based ✓; peer presence polled ✗ |

**Gap summary:** the two structural pillars Talo lacks vs all three references are
**(a) a local persistent message database** rendered before network, and
**(b) delta synchronization** instead of refetching. Everything else (prefetch, thumbnails,
scroll anchors, outbox) builds on those two.

---

## 4. Proposed Target Architecture

Keep the existing layering contract (Screen → Hook → Store/Service → Supabase) and Zustand-only
state. Insert **two new local layers** underneath the store, and replace the global realtime
fan-out:

```
                        ┌────────────────────────────────────────────┐
                        │  Screen (app/chat/[roomId].tsx)            │
                        └───────────────────┬────────────────────────┘
                                            │ hooks (unchanged API surface)
                        ┌───────────────────▼────────────────────────┐
                        │  Zustand stores  (render window only)      │
                        │  chatStore: bounded per-room window + LRU  │
                        └───────┬───────────────────────┬────────────┘
                 hydrate (sync) │                       │ write-through (async)
                        ┌───────▼────────┐     ┌────────▼─────────┐
                        │  SQLite cache  │◄────┤   Sync Engine    │
                        │ (expo-sqlite)  │     │ syncService.ts   │
                        │ messages,rooms,│     │ delta pull, gap  │
                        │ profiles,outbox│     │ fill, outbox     │
                        └───────┬────────┘     └────────┬─────────┘
                                │                       │
                        ┌───────▼───────────────────────▼────────────┐
                        │  Supabase                                  │
                        │  · PostgREST (delta RPCs)                  │
                        │  · Realtime: room:${id} (unchanged)        │
                        │  · Realtime: user:${id} broadcast (NEW —   │
                        │    replaces unfiltered global:messages)    │
                        │  · Storage: chat-media + thumbnails        │
                        └────────────────────────────────────────────┘
```

### Principles

1. **Local-first render.** Any screen renders from SQLite/RAM first; network only reconciles.
2. **Single writer.** All server data enters the app through the Sync Engine (realtime events,
   delta pulls, pagination fetches all funnel into one `applyServerMessages()` path that
   writes SQLite and patches the Zustand window). Kills dedup/race bugs at the root.
3. **Bounded RAM.** Zustand holds a *window* (≤ `MESSAGE_WINDOW_SIZE` per room, LRU across
   ≤ `MAX_CACHED_ROOMS` rooms). SQLite is the unbounded tier; disk image cache is the media tier.
4. **Per-user, not per-system, realtime.** The room-list feed becomes a private broadcast
   channel `user:${userId}` fed by a DB trigger, carrying pre-joined payloads (sender name
   included → kills the N+1).
5. **Everything feature-flagged.** Each phase ships behind a constant in `src/lib/constants.ts`
   so rollback is a one-line change (see §18).

---

## 5. Memory Flow

```
                     ┌── RAM (Zustand) ──────────────────────────────┐
                     │ chatStore.messages[roomId] = window            │
                     │  · active room: up to MESSAGE_WINDOW_SIZE(200) │
                     │  · inactive rooms: trimmed to TRIM_SIZE (50)   │
                     │  · LRU: keep MAX_CACHED_ROOMS (8), evict rest  │
                     └──────────────▲──────────────┬─────────────────┘
                        hydrate     │              │ overflow / evict
                     ┌──────────────┴──────────────▼─────────────────┐
                     │ SQLite (persistent, unbounded*)                │
                     │  *pruned to MAX_PERSISTED_PER_ROOM (1000)      │
                     └──────────────▲──────────────┬─────────────────┘
                                    │              │
                     ┌──────────────┴──────────────▼─────────────────┐
                     │ Network (Supabase)                             │
                     └────────────────────────────────────────────────┘
```

Rules:

- **On room open:** synchronously read the last `MESSAGES_PER_PAGE` rows from SQLite into the
  window (expo-sqlite sync API — sub-millisecond for indexed reads) → paint → then delta-pull.
- **On room leave:** trim the room's window to `TRIM_SIZE` newest messages (enough for instant
  re-open paint); mark LRU timestamp.
- **On LRU pressure** (`> MAX_CACHED_ROOMS` rooms in the map): drop the coldest room's window
  entirely (its data lives in SQLite; re-open re-hydrates).
- **On pagination past the window:** older pages append to the window while the room is active;
  the trim happens only on leave — so in-room history reading is never fought by eviction.
- `loading`/`hasMore` become per-room: `loadingByRoom: Record<string, boolean>` (fixes B7).

---

## 6. Network Flow

Every network interaction, in order of preference:

```
1. Realtime push (room:${id} + user:${id})           — steady-state, zero polling
2. Delta pull   (get_room_messages_since RPC)         — reconnect / foreground / room open
3. Page pull    (getMessages cursor, configurable)    — history pagination beyond SQLite
4. Full pull    (get_user_rooms)                      — first login / cache-version bump only
```

### Request lifecycle changes

- **Room open (warm):** paint from SQLite → `get_room_messages_since(roomId, last_synced_at)`
  → apply diff. Typical payload: 0–3 messages instead of a full 20-row page.
- **Room open (cold, never synced):** paint nothing-from-cache → normal page-1 fetch → persist.
- **Pagination:** page size must remain configurable (`MESSAGES_PER_PAGE`) and should only be
  adjusted after measuring real performance improvements (benchmark phase A2, §19); check SQLite
  first — only hit the network when the local history runs out (`has_full_history` flag per room).
- **Reconnect:** delta pull for the active room + `get_rooms_delta` for the list (see §13) —
  replaces both full refetches (fixes B5).
- **Dedup/inflight guard:** the Sync Engine keeps an in-flight map keyed by
  `${roomId}:${cursor}` so double-triggered `onStartReached` or concurrent hooks can't issue
  duplicate requests (React-Query-style dedup without adding React Query).

---

## 7. Cache Flow

Three cache tiers with explicit invalidation:

| Tier | Store | Scope | Invalidation |
|------|-------|-------|--------------|
| L1 RAM | Zustand window | ≤ 8 rooms × ≤ 200 msgs | LRU on room switch; `reset()` on logout |
| L2 Disk | SQLite | all rooms, ≤ 1000 msgs/room | tombstones via delta sync; pruned on app start; `DROP` on logout & on `CACHE_SCHEMA_VERSION` bump |
| L3 Media | expo-image disk cache | thumbnails + full images | expo-image internal LRU; `Image.clearDiskCache()` on logout |

Write paths (single-writer rule):

```
send (optimistic)  → L1 + L2(status='pending', outbox row)
send confirmed     → L1 replace + L2 upsert(status='sent') + outbox delete
realtime INSERT    → applyServerMessages → L1 (if room windowed) + L2 upsert
realtime UPDATE    → same, preserving local reaction/vote embeds (existing rule kept)
realtime DELETE    → L1 remove + L2 tombstone (deleted_at) — tombstones kept for delta sync
delta pull         → applyServerMessages batch (same path as realtime)
pagination         → applyServerMessages batch
```

Read path: `hydrateRoom(roomId)` = SQLite SELECT → window; never blocks on network.
Room list: `get_user_rooms` result persisted to a `rooms` table; the tab renders it instantly on
cold start, then reconciles with the RPC in the background (stale-while-revalidate, manual).

---

## 8. Realtime Flow

### Kept: `room:${roomId}` (per-room, filtered postgres_changes)

Unchanged listener set (messages / message_reactions / poll_votes / room_participants).
Two changes:

1. Handlers route through `syncService.applyServerMessages` instead of raw store calls
   (so SQLite stays consistent).
2. On `SUBSCRIBED` after a drop → **delta pull** (`since last_synced_at`) instead of
   refetching page 1.

### Replaced: `global:messages` → `user:${userId}` private broadcast

```
messages INSERT
   └─ DB trigger fn broadcast_message_to_participants()
        └─ for each participant (except sender):
             realtime.send(topic := 'user:' || participant_id,
                           event := 'new_message',
                           payload := { room_id, message_id, content-preview,
                                        sender_id, sender_name, type, created_at })
```

- Channel config: `private: true` + RLS on `realtime.messages` topic so only the owner can
  subscribe to `user:${id}`.
- Payload carries `sender_name` **pre-joined in the trigger** → deletes the client-side
  sender-name LRU/N+1 entirely (fixes B1 + B9 together).
- `room_participants` and `room_reads` events move to the same per-user topic
  (`membership_changed`, `read_advanced` events) — the global channel is deleted.
- `useRealtimeRooms` keeps its AppState foreground-resync listener, but resync becomes a
  rooms-delta call (§13), not a full RPC.

### Presence upgrade (fixes B10)

Replace `get_peer_profile` polling with a Supabase Presence channel `presence:global`
(track on login with `{ user_id, online_at }`; DM header derives peer status from presence
sync events). The 45 s DB heartbeat stays as the fallback for "last seen" persistence.

---

## 9. Image Loading Flow

Target: Telegram-style progressive media.

```
Pick (quality .8) → resize/compress (expo-image-manipulator, max edge 2048, jpeg .8)
                 → generate thumbnail  (max edge 32 → base64 data URI, ~1 KB)
                 → optimistic bubble renders local URI instantly
                 → upload resized original (parallel per album, as today)
                 → message row: media_url + attachments[{url, w, h, thumb}]
```

Render pipeline (`AlbumGrid` / image bubble):

1. Bubble reserves exact aspect-ratio box from stored `w`/`h` (no layout shift — critical for
   `maintainVisibleContentPosition` stability).
2. `expo-image` `placeholder={thumb}` (inline base64 thumbnail, zero network) with
   `placeholderContentFit="cover"` + short cross-fade.
3. Full image loads with `cachePolicy="memory-disk"` + `recyclingKey` (kept as-is).
4. **Prefetch:** when a page of messages is applied, `Image.prefetch()` the media URLs of the
   newest `IMAGE_PREFETCH_COUNT` (10) image messages (disk cache warm before scroll reaches them).

Notes:

- Thumbnails ride in `attachments` JSON — **no schema migration needed**; old messages without
  `thumb`/`w`/`h` degrade gracefully to today's behavior.
- Supabase Storage image transformations are a paid-tier option; the client-side resize path
  above is the default plan and works on the current tier.
- Optional (flagged separately): re-encode to WebP on upload for ~30 % smaller payloads.

---

## 10. Scroll Restoration Flow

Two behaviors, matching Telegram:

### A. Reopen restore (per-room anchor)

```
on scroll (throttled 500 ms) → record { anchorMessageId, offsetInItem } in roomStore (RAM)
on room leave               → keep anchor if user was NOT at bottom; clear if at bottom
on room open                → if anchor exists and its message is in the hydrated window:
                                 FlashList initial scroll to anchor index
                              else: startRenderingFromBottom (today's behavior)
```

- Anchors live in RAM only (session-scoped) — restoring week-old scroll positions is
  anti-UX; Telegram also only restores recent positions.
- When restored above the bottom, show a floating **"N tin nhắn mới ↓"** pill (count from the
  unread watermark) that jumps to bottom.

### B. Scroll-to-message (reply/pin/search jump)

```
target in current window? → scrollToIndex + highlight flash
target in SQLite?         → re-window around the target (SELECT 25 before + 25 after),
                            swap window, scroll to it, set bidirectional hasMore flags
else                      → fetch a window around it via get_messages_around RPC → same
```

This requires the window to support **bidirectional pagination** (`hasNewer[roomId]` in
addition to `hasMore`), with `onEndReached` fetching newer pages when the user is in a
jumped-back state. This is the single most intricate piece of the roadmap (see §17 R4).

---

## 11. Room Switching Flow

Target: 0-network-blocking switches.

```
User taps room in list
  1. (already done at press-in) prefetchRoom(roomId):     ← §14
       hydrate window from SQLite if not resident
  2. Navigate. First frame renders the hydrated window — no spinner.
  3. useMessages mount:
       setActiveRoom → clearUnread → mark read (unchanged)
       syncService.deltaPull(roomId)  ← replaces fetchMessages(roomId) full page-1
  4. Realtime channel subscribes (unchanged, per-room).
  5. Deferred (InteractionManager.runAfterInteractions):
       participants refresh, pinned, saved, scheduled, presence — everything currently
       fetched eagerly in the 804-line screen moves after first interaction completes.
Old room: window trimmed to TRIM_SIZE, LRU-stamped, channel torn down (unchanged).
```

Perceived result: switching between two recently used rooms is pure RAM/SQLite → paint,
with a background diff that usually applies zero changes.

---

## 12. Offline Strategy

### Detection

Add `@react-native-community/netinfo` (Expo SDK 56 compatible) behind
`src/hooks/useConnectivity.ts` exposing `{ isOnline }` + an imperative
`connectivity.isOnline()` for services. Realtime channel status remains the second signal
(socket can die while NetInfo says online).

### Reads

Fully served by SQLite: rooms list, last ≤ 1000 messages/room, profiles, participants.
Offline banner ("Đang chờ kết nối…") rendered from `useConnectivity` in the chat header and
rooms tab — UI strings in Vietnamese per project convention.

### Writes — Outbox

```
SQLite table: outbox(id, room_id, kind ['text'|'album'|'poll'|'reaction'|'vote'],
                     payload JSON, local_uris JSON, created_at, attempts, last_error)
```

- `sendMessage` offline (or failed with a network error): keep the optimistic bubble with
  `status='pending'` (clock icon, Telegram-style) instead of removing it; enqueue outbox row.
- Flush triggers: NetInfo online transition, app foreground, realtime `SUBSCRIBED`,
  and after each successful send. Strictly FIFO **per room** (ordering guarantee), rooms
  flushed in parallel.
- Retry: exponential backoff 2 s → 4 s → 8 s → … capped 60 s; after
  `OUTBOX_MAX_ATTEMPTS` (10) mark `status='failed'` → bubble shows retry/delete affordance.
- Idempotency: client generates the message UUID (`expo-crypto randomUUID`) and inserts with
  explicit `id` — a retried INSERT that actually succeeded server-side becomes a PK conflict
  handled as success. This also simplifies optimistic replace (temp ID == final ID; the
  `replaceOptimisticMessage` race handling collapses to a status flip).
- Album uploads offline: local URIs persist in the outbox row; upload runs at flush time.
- Non-durable actions (typing, presence, read-watermark) are **not** queued — last-write-wins
  on reconnect is correct for them.

---

## 13. Delta Sync Strategy

### Per-room message delta

New RPC `get_room_messages_since(p_room_id uuid, p_since timestamptz, p_limit int default 200)`:

```sql
-- returns rows where updated_at > p_since (INSERTs, edits, recalls all bump updated_at)
-- ordered by updated_at asc, capped at p_limit; includes soft-deleted rows (tombstones)
```

- Client stores `last_synced_at` per room in a SQLite `sync_state` table = max
  `updated_at` seen from any server row for that room.
- Recall/edit propagate because they update the row (`deleted_at` set / content changed);
  hard deletes (undo-send) are the one gap — covered by the room realtime DELETE event while
  subscribed, and by a reconciliation rule: undo-send rows are < 8 s old, so on delta apply the
  client re-verifies IDs of any local messages newer than `p_since` that the delta didn't return
  and drops them.
- If the delta returns `p_limit` rows (gap too big), fall back to a fresh page-1 fetch and mark
  older local history as `stale` (re-validated lazily on scroll).
- **Reactions/votes:** postgres_changes remains the live path; delta correctness comes from
  refetching embeds for messages returned in the delta (they arrive with embeds, same select
  as `getMessages`). A `touch_message_on_reaction` trigger (bump `messages.updated_at` on
  reaction/vote change) makes reaction changes delta-visible; flagged optional — without it,
  reactions changed while offline reconcile on the next page fetch only.

### Room-list delta

New RPC `get_rooms_delta(p_user_id uuid, p_since timestamptz)` returning only rooms whose
`last_message_at`/membership/read state changed since `p_since` — replaces full
`get_user_rooms` on reconnect/foreground. Also the chance to fix B11: maintain
`room_participants.unread_count` (or a materialized counter) bumped by trigger instead of
scanning `messages` per call. Full `get_user_rooms` remains for first login and as the
fallback.

### Sync scheduling

`syncService.syncNow(scope)` with scopes `active-room` | `rooms` | `all`; invoked on:
reconnect (per-channel), foreground (AppState), room open, pull-to-refresh. Concurrent calls
coalesce per scope.

---

## 14. Prefetch Strategy

All prefetch is **flag-gated and yields to interactions** (InteractionManager) — prefetch must
never compete with an active scroll or animation.

| Trigger | What is prefetched |
|---------|--------------------|
| App start (after rooms list paints) | Delta-pull + window-hydrate for the top `PREFETCH_TOP_ROOMS` (5) rooms by recency |
| Room-list row `onPressIn` | `hydrateRoom(roomId)` from SQLite (~1 frame head start before navigation commits) |
| Message page applied | `Image.prefetch` newest 10 image URLs of the page (§9) |
| Notification received (foreground handler) | Delta-pull the notified room so tapping the banner opens warm |
| Reply context visible | Prefetch the replied-to message's media thumb |

Explicit non-goals: no route-bundle prefetching (Expo Router lazy screens are cheap), no
speculative next-page-of-history fetch (history reading is already local after Phase B1).

---

## 15. Persistence Strategy

### Engine

`expo-sqlite` (SDK 56) — sync API for reads on the hot path, WAL mode, prepared statements.
Web fallback: expo-sqlite's wasm/OPFS support where available; otherwise a no-op adapter —
web silently degrades to today's network-first behavior (guarded by a `storage.isAvailable`
capability check, consistent with the project's `expo-notifications` web-safety convention).

### Schema (`src/lib/db.ts`)

```sql
PRAGMA journal_mode = WAL;
CREATE TABLE messages (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, sender_id TEXT NOT NULL,
  content TEXT, type TEXT NOT NULL, media_url TEXT,
  reply_to TEXT, thread_id TEXT, is_edited INTEGER DEFAULT 0,
  pinned_at TEXT, pinned_by TEXT, deleted_at TEXT, deleted_by TEXT,
  attachments TEXT, metadata TEXT,           -- JSON blobs
  reactions TEXT, poll_votes TEXT,           -- embedded JSON (denormalized, matches MessageWithMeta)
  status TEXT NOT NULL DEFAULT 'sent',       -- 'pending' | 'sent' | 'failed'
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_messages_room_created ON messages(room_id, created_at DESC);
CREATE TABLE rooms      (room_id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT); -- RoomWithLastMessage JSON
CREATE TABLE profiles   (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);
CREATE TABLE sync_state (room_id TEXT PRIMARY KEY, last_synced_at TEXT, has_full_history INTEGER);
CREATE TABLE outbox     (id TEXT PRIMARY KEY, room_id TEXT, kind TEXT, payload TEXT,
                         local_uris TEXT, created_at TEXT, attempts INTEGER, last_error TEXT);
CREATE TABLE meta       (key TEXT PRIMARY KEY, value TEXT);  -- schema_version, owner_user_id
```

Design choices:

- **Denormalized embeds** (reactions/votes as JSON on the message row): matches the existing
  `MessageWithMeta` shape 1:1, so hydrate is `SELECT → JSON.parse → render` with zero joins.
  Server remains the normalized source of truth; SQLite is a *cache*, not a second database.
- **Versioned, droppable:** `CACHE_SCHEMA_VERSION` in `meta`; mismatch → drop all tables and
  recreate. No migration framework for a cache. This is also the rollback hatch (§18).
- **Security scoping:** DB file name includes the user ID hash; on logout `chatStore.reset()`
  extends to closing + deleting the DB file, and `Image.clearDiskCache()`. If app-lock is
  enabled, SQLCipher is out of scope — documented trade-off: cached plaintext on device,
  equivalent to Telegram's default local storage model.
- **Pruning:** on app start (deferred), delete per room beyond newest `MAX_PERSISTED_PER_ROOM`
  (1000) and tombstones older than 30 days.

---

## 16. File-by-File Implementation Plan

### New files

| File | Contents |
|------|----------|
| `src/lib/db.ts` | expo-sqlite open/versioning/WAL, schema DDL, `isAvailable` capability flag, typed query helpers (`getMessagesPage`, `upsertMessages`, `pruneRoom`, `resetDb`) |
| `src/services/syncService.ts` | The Sync Engine: `applyServerMessages` (single writer), `deltaPull(roomId)`, `syncRooms`, `hydrateRoom`, in-flight dedup map, `last_synced_at` bookkeeping |
| `src/services/outboxService.ts` | enqueue / flush loop / backoff / per-room FIFO / `retryFailed(id)` / `discardFailed(id)` |
| `src/hooks/useConnectivity.ts` | NetInfo subscription → `{ isOnline }`; imperative getter for services |
| `src/hooks/useScrollAnchor.ts` | per-room anchor record/consume logic for MessageList (§10 A) |
| `src/lib/imagePipeline.ts` | resize + thumbnail generation (expo-image-manipulator), attachment metadata builder |
| `src/components/chat/NewMessagesPill.tsx` | floating "N tin nhắn mới ↓" jump-to-bottom pill |
| `supabase/migrations/000NN_delta_sync.sql` | `get_room_messages_since`, `get_messages_around`, `get_rooms_delta` RPCs; optional `touch_message_on_reaction` trigger |
| `supabase/migrations/000NN_user_broadcast.sql` | `broadcast_message_to_participants` trigger fn + trigger; `realtime.messages` RLS policy for `user:${id}` topics |
| `supabase/migrations/000NN_unread_counter.sql` | trigger-maintained unread counter + `get_user_rooms` rewrite (B11) |

### Modified files

| File | Change |
|------|--------|
| `src/stores/chatStore.ts` | `loading` → `loadingByRoom`; add `hasNewer` map; add `trimRoom`, `evictLru`, `hydrateRoom` actions; window-size enforcement in `addMessage`/`fetchMessages`; message `status` field pass-through; `reset()` also resets DB via `db.resetDb()` |
| `src/hooks/useMessages.ts` | Mount effect: hydrate → deltaPull instead of `fetchMessages`; offline-aware `sendMessage` (pending status + outbox instead of remove-on-error); client-generated UUID ids; expose `retrySend`/`discardSend`; `loadMore` reads per-room loading + SQLite-first |
| `src/hooks/useRealtime.ts` | Room channel handlers route through `syncService.applyServerMessages`; reconnect → deltaPull; **delete** `global:messages` + sender-name LRU; new `user:${id}` broadcast subscription with `private: true`; foreground resync → `get_rooms_delta` |
| `src/services/messageService.ts` | Accept explicit `id` on insert (idempotent sends); PK-conflict-as-success handling; album path calls `imagePipeline` before upload; embed `w/h/thumb` in attachments; page size param |
| `src/services/roomService.ts` | `getRoomsDelta` wrapper; rooms persisted through `db` |
| `src/stores/roomStore.ts` | Hydrate rooms from SQLite before `fetchRooms`; write-through on updates; scroll-anchor map |
| `src/hooks/usePresence.ts` | Presence-channel implementation replacing the 30 s poll (flag-gated) |
| `src/components/chat/MessageList.tsx` | `getItemType` (text/media/poll/system); anchor-based initial scroll; bidirectional `onEndReached` for jumped state; scroll-anchor recording; NewMessagesPill mount |
| `src/components/chat/MessageBubble.tsx` | Pending-clock / failed-retry states; aspect-ratio-reserved image boxes with `placeholder` thumb |
| `src/components/chat/AlbumGrid.tsx` | thumb placeholders + reserved aspect boxes |
| `app/chat/[roomId].tsx` | Defer non-critical fetches via `InteractionManager` (§11 step 5); offline banner |
| `app/(tabs)/index.tsx` | FlatList → FlashList v2 (B14); `onPressIn` prefetch hook |
| `src/lib/constants.ts` | New constants + feature flags: `MESSAGE_WINDOW_SIZE`, `TRIM_SIZE`, `MAX_CACHED_ROOMS`, `MAX_PERSISTED_PER_ROOM`, `OUTBOX_MAX_ATTEMPTS`, `PREFETCH_TOP_ROOMS`, `IMAGE_PREFETCH_COUNT`, `CACHE_SCHEMA_VERSION`, and `FEATURE_*` flags. `MESSAGES_PER_PAGE` remains configurable and is only adjusted after the phase-A2 benchmarks prove a real improvement (§19) |
| `package.json` | + `expo-sqlite`, `@react-native-community/netinfo`, `expo-image-manipulator` (all Expo SDK 56 native modules → **requires a new dev client / EAS build**; installed in the standalone Preparation Phase PREP, §19, with zero behavior change) |
| `src/types/index.ts` | `MessageStatus`, outbox types, `AttachmentMeta { url, w?, h?, thumb? }` |
| `locales/{vi,en}/chat.json` | Strings: offline banner, pending/failed states, new-messages pill, retry/discard |

Database types: after migrations, regenerate `src/types/database.ts` per the standard workflow.

---

## 17. Risk Analysis

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | **SQLite/RAM/server divergence** (three copies of truth) | High | High | Single-writer rule (`applyServerMessages` is the only ingest path); SQLite is droppable cache — any suspicion → version bump wipes it; recovery = today's behavior |
| R2 | **Broadcast trigger bugs** silently drop room-list updates | Medium | High | Ship `user:${id}` channel **in parallel** with `global:messages` for one release (flag chooses consumer); compare event streams in dev before deleting the old channel |
| R3 | **Delta sync misses hard deletes** (undo-send while offline) | Medium | Low | Reconciliation rule in §13; worst case a ghost message clears on next page-1 fetch |
| R4 | **Bidirectional windowing breaks `maintainVisibleContentPosition`** (jump-to-message state) | High | Medium | Isolate as the last sub-phase; scroll-to-message only enabled when window swap verified on iOS/Android/web; fallback = keep feature off, everything else still lands |
| R5 | **Native module additions** (sqlite, netinfo, image-manipulator) break the EAS/dev-client builds | Medium | Medium | All are Expo SDK 56 first-party/compatible; add in one dedicated build PR; verify per `how-to-build-local.md` before feature work |
| R6 | **Idempotent-ID switch** conflicts with existing temp-ID logic (undo window, replaceOptimistic) | Medium | Medium | The client-UUID model *simplifies* these paths; migrate them in the same PR with the store change, never half-and-half |
| R7 | **Web platform gaps** (SQLite/OPFS, NetInfo semantics) | High | Low | Capability-gated no-op adapter; web keeps current behavior — no regression, just no upgrade |
| R8 | Outbox flush storms after long offline (N rooms × M messages) | Low | Medium | Per-room FIFO with global concurrency cap (3 rooms); backoff on failure |
| R9 | Trigger-maintained unread counters drift | Medium | Low | Nightly-equivalent self-heal: full `get_user_rooms` still runs on cold start and corrects counters |
| R10 | A page-size increase (if benchmarks recommend one) + windows regress low-end Android render perf | Low | Medium | Page size changes only after A2 benchmarks prove a win; `getItemType` + FlashList v2 recycling land first (A1); window cap bounds worst case |
| R11 | Cached plaintext messages on device (privacy expectation) | — | Medium | Documented trade-off (§15); DB deleted on logout; per-user DB file; app-lock still gates UI |

---

## 18. Rollback Strategy

Every phase is independently revertible without data loss, because SQLite is strictly a cache:

1. **Feature flags in `constants.ts`** — each phase reads one flag:
   `FEATURE_LOCAL_CACHE`, `FEATURE_OUTBOX`, `FEATURE_DELTA_SYNC`, `FEATURE_USER_BROADCAST`,
   `FEATURE_IMAGE_PIPELINE`, `FEATURE_SCROLL_RESTORE`, `FEATURE_JUMP_TO_MESSAGE`,
   `FEATURE_PREFETCH`, `FEATURE_PRESENCE_CHANNEL`. Flag off = the exact current code path
   (paths are kept, not deleted, until the flag has survived one production release).
2. **Cache kill-switch:** bumping `CACHE_SCHEMA_VERSION` wipes every client's SQLite on next
   launch — one-line remote-less rollback for any data-shape bug.
3. **Server rollback:** new RPCs are additive (old `getMessages`/`get_user_rooms` untouched).
   The broadcast trigger can be `DROP TRIGGER`-ed independently; per R2, `global:messages`
   is only removed one release **after** `user:${id}` is proven, so reverting the client flag
   restores the old feed instantly during the overlap window.
4. **Outbox rollback:** flag off → sends revert to remove-on-error; any stranded outbox rows
   are surfaced once as failed bubbles (user can retry/discard) — no silent loss.
5. **Build rollback:** native deps land in the dedicated Preparation Phase PREP (its own PR
   and build, with zero behavior change); reverting that single PR restores the previous dev
   client if native issues appear.

---

## 19. Estimated Complexity — Execution Playbook (Milestones, Phases & Success Criteria)

The work is organized into a standalone **Preparation Phase** plus three high-level milestones.
Milestones group phases by *theme*; execution order is governed by the dependency graph in §20
(phases from different milestones interleave where dependencies require it). Every phase is
**one pull request, one feature flag, one rollback unit**, and must satisfy its **Success
Criteria** before the next dependent phase starts. All architecture decisions, flows, and
file-level details in §4–§16 are unchanged — this section only sequences them.

### Milestone map

| Milestone | Theme | Phases | Bottlenecks addressed |
|-----------|-------|--------|-----------------------|
| — | Preparation (infrastructure only) | PREP | none (by design) |
| **A — Frontend Performance** | Perceived rendering, scrolling, and media latency on the client | A1, A2, A3, A4, A5 | B7, B8, B12, B13, B14 |
| **B — Local First** | Persistent local data tier; the app works before (and without) the network | B1, B2 | B2, B3, B4, B6 |
| **C — Smart Synchronization** | Replace refetching and polling with deltas, pushes, and prefetch | C1, C2, C3 | B1, B5, B9, B10, B11 |

---

### Preparation Phase

#### PREP — Native dependency installation (infrastructure only)

- **Scope:** add `expo-sqlite`, `@react-native-community/netinfo`, `expo-image-manipulator`
  to `package.json`; rebuild the dev client and all EAS profiles; verify per
  `how-to-build-local.md`.
- **Hard rule: no application behavior changes are allowed in this phase.** No new module may
  be imported by application code, no feature flag is introduced or flipped, no runtime code
  path changes. The app must behave byte-for-byte identically before and after this PR — its
  only output is a new build that *contains* the native modules, dormant.
- **Dependencies:** none. **Complexity:** Low-Med. **Effort:** 1–2 days (build-dominated).
  **Risk:** R5.
- **Success Criteria**
  - [ ] Android dev client, `preview` and `production` EAS builds, and the web export all
        build successfully.
  - [ ] No application source file under `app/` or `src/` is modified (diff limited to
        `package.json`, lockfile, and native config).
  - [ ] Smoke test on the new dev client: login, open room, send/receive, paginate, images,
        calls — all identical to the previous build.
  - [ ] Web bundle boots with no new warnings/errors from the added packages.

---

### Milestone A — Frontend Performance

Client-only improvements to rendering and perceived latency. A1 and A2 need no new
dependencies and start immediately; A3–A5 depend on later infrastructure (noted per phase).

#### A1 — Rendering quick wins

- **Scope:** per-room `loadingByRoom`/`hasMore` (fixes B7); `getItemType` on the chat
  FlashList (B13); room list FlatList → FlashList v2 (B14); defer non-critical chat-screen
  fetches via `InteractionManager` (§11 step 5).
- **Flag:** none — behavior-preserving refactors; each change is single-file revertible.
- **Dependencies:** none. **Complexity:** Low. **Effort:** 1–2 days. **Risk:** Low.
- **Success Criteria**
  - [ ] Pagination in room X is not blocked while room Y is fetching (store-level check:
        two concurrent `fetchMessages` maintain independent loading states).
  - [ ] No frame-rate regression on a low-end Android device (perf monitor before/after
        while scrolling a mixed text/album/poll room).
  - [ ] Room list scrolls without blank cells or layout jumps after the FlashList migration;
        pull-to-refresh still works.
  - [ ] All existing flows manually verified: send, edit, recall, reactions, receipts,
        pagination, room switching.

#### A2 — Pagination benchmark & tuning

- **Scope:** make pagination measurable. Instrument fetch duration, time-to-first-page, and
  dropped frames during history scroll; run the same script with at least two candidate page
  sizes on real Android hardware and on web.
- **Policy:** **Page size must remain configurable and should only be adjusted after
  measuring real performance improvements.** `MESSAGES_PER_PAGE` stays at its current value
  (20) unless the benchmark demonstrates a clear win; any change is recorded here with the
  numbers that justified it.
- **Flag:** none (measurement only; a page-size change, if any, is a one-line constant edit).
- **Dependencies:** A1 (so recycling improvements don't skew results). **Complexity:** Low.
  **Effort:** ~1 day. **Risk:** Low (R10 guard).
- **Success Criteria**
  - [ ] A repeatable benchmark procedure is documented (device, room fixture, metrics).
  - [ ] Results recorded for ≥ 2 candidate page sizes on at least one physical Android
        device and web.
  - [ ] A written decision (keep or change `MESSAGES_PER_PAGE`) with supporting numbers is
        appended to this document; the constant is changed **only** if a measured improvement
        exists with no frame-rate regression.

#### A3 — Image pipeline

- **Scope:** §9 in full — client resize/compress, inline base64 thumbnails, `w/h` aspect-ratio
  reserved boxes, `Image.prefetch` of applied pages (fixes B8).
- **Flag:** `FEATURE_IMAGE_PIPELINE`. **Dependencies:** PREP (expo-image-manipulator).
  **Complexity:** Med. **Effort:** 2–3 days. **Risk:** Low.
- **Success Criteria**
  - [ ] New image messages carry `w/h/thumb` in `attachments`; old messages render exactly
        as before (graceful degradation verified).
  - [ ] No layout shift when a media bubble's full image loads (scroll position stable
        during load — verified in a media-heavy room on Android and web).
  - [ ] Upload payload size for a reference photo is measurably reduced (before/after
        recorded).
  - [ ] Thumbnails paint with zero network requests (placeholder is inline data URI).
  - [ ] Flag off → current upload/render path, unchanged.

#### A4 — Scroll restoration (reopen anchors + new-messages pill)

- **Scope:** §10 A — per-room session anchors, anchor-based initial scroll, floating
  "N tin nhắn mới ↓" pill.
- **Flag:** `FEATURE_SCROLL_RESTORE`. **Dependencies:** B1 (hydrated windows must exist for
  anchors to resolve on reopen). **Complexity:** Med. **Effort:** 2 days. **Risk:** Low.
- **Success Criteria**
  - [ ] Leave a room mid-history and reopen → position restored within one bubble of the
        anchor, on Android and web.
  - [ ] Leaving at the bottom → reopen starts at the bottom (today's behavior preserved).
  - [ ] Pill appears with the correct unread count when restored above the bottom; tapping
        it jumps to the newest message.
  - [ ] Pagination scroll preservation (`maintainVisibleContentPosition`) unaffected.
  - [ ] Flag off → always-bottom behavior, unchanged.

#### A5 — Scroll-to-message (jump to reply/pin/search hit)

- **Scope:** §10 B — bidirectional windowing (`hasNewer`), window swap around a target from
  SQLite or `get_messages_around`, highlight flash. Deliberately the **last phase in the
  entire roadmap** (see §17 R4 and §20).
- **Flag:** `FEATURE_JUMP_TO_MESSAGE`. **Dependencies:** B1 (window/hydrate primitives) +
  C1 (the `get_messages_around` RPC ships in the delta-sync migration). **Complexity:**
  **High**. **Effort:** 3–5 days. **Risk:** High (R4).
- **Success Criteria**
  - [ ] Jump from a reply preview, pinned banner, and search result lands on and highlights
        the target in all three tiers (in-window / SQLite / network).
  - [ ] No visible scroll jump after the window swap (`maintainVisibleContentPosition`
        verified on iOS, Android, and web).
  - [ ] Scrolling back down from a jumped state pages newer messages correctly and re-enables
        the live tail at the bottom.
  - [ ] Flag off → no jump affordances; every other phase's behavior is untouched.

---

### Milestone B — Local First

The persistent data tier. B1 is the keystone of the whole roadmap: B2, A4, A5, C1, and C3
are all layers over its primitives.

#### B1 — SQLite cache + hydrate-first rendering

- **Scope:** §5, §7, §15 in full — `src/lib/db.ts` (schema, versioning, capability gating),
  `syncService` skeleton (`applyServerMessages` single-writer, `hydrateRoom`), write-through
  from all ingest paths, LRU windowing (`MESSAGE_WINDOW_SIZE` / `TRIM_SIZE` /
  `MAX_CACHED_ROOMS`), room-list persistence, per-user DB file, logout wipe.
- **Flag:** `FEATURE_LOCAL_CACHE`. **Dependencies:** PREP. **Complexity:** **High**.
  **Effort:** 4–6 days. **Risk:** High (R1, R7).
- **Success Criteria**
  - [ ] On a previously synced device in airplane mode: cold start renders the room list and
        each visited room's recent messages entirely from SQLite.
  - [ ] Reopening a visited room paints with **zero blocking network requests** before first
        frame (network inspector).
  - [ ] After visiting 15 rooms, at most `MAX_CACHED_ROOMS` windows are resident in the
        Zustand store, each within its size cap (store inspection).
  - [ ] Logout closes and deletes the DB file; a `CACHE_SCHEMA_VERSION` bump wipes and
        cleanly recreates the cache on next launch.
  - [ ] Race tests pass: optimistic send + realtime echo, concurrent pagination, realtime
        UPDATE preserving reaction/vote embeds — no duplicates, no ordering regressions.
  - [ ] Web (no SQLite): capability check degrades to today's network-first behavior with no
        errors.
  - [ ] Flag off → behavior identical to the current release.

#### B2 — Offline outbox + connectivity UX

- **Scope:** §12 in full — NetInfo-backed `useConnectivity`, outbox table + flush loop with
  per-room FIFO and backoff, client-generated UUIDs (idempotent sends), pending/failed bubble
  states, retry/discard affordances, offline banner ("Đang chờ kết nối…").
- **Flag:** `FEATURE_OUTBOX`. **Dependencies:** B1. **Complexity:** Med-High.
  **Effort:** 3–4 days. **Risk:** Med (R6, R8).
- **Success Criteria**
  - [ ] Sending in airplane mode shows a pending (clock) bubble that **survives an app
        restart** and auto-sends on reconnect.
  - [ ] Multiple queued messages in one room flush strictly in order; messages across rooms
        flush in parallel within the concurrency cap.
  - [ ] Kill the app mid-send and retry → exactly one message on the server (PK idempotency
        verified).
  - [ ] After `OUTBOX_MAX_ATTEMPTS` failures the bubble offers retry/discard, and both work.
  - [ ] Offline banner appears/disappears with connectivity changes; undo-send still works
        within its window.
  - [ ] Flag off → sends revert to remove-on-error; stranded outbox rows surface once as
        failed bubbles (no silent loss).

---

### Milestone C — Smart Synchronization

Replace full refetches and polling with deltas and per-user push.

#### C1 — Delta sync

- **Scope:** §13 in full — migration with `get_room_messages_since`, `get_messages_around`,
  `get_rooms_delta` RPCs (+ optional `touch_message_on_reaction` trigger); `sync_state`
  bookkeeping; reconnect/foreground/room-open integration; gap-overflow fallback; type
  regeneration per the standard workflow.
- **Flag:** `FEATURE_DELTA_SYNC`. **Dependencies:** B1. **Complexity:** Med-High.
  **Effort:** 3–4 days. **Risk:** Med (R3).
- **Success Criteria**
  - [ ] Killing the network for 30 s while messages arrive → on reconnect, only the delta RPC
        runs (no page-1 refetch in the network log) and the missed messages appear.
  - [ ] Edits and recalls performed by another device while this client was offline reconcile
        correctly on the next delta pull.
  - [ ] A gap larger than `p_limit` triggers the page-1 fallback and marks older history
        stale, with no visible corruption.
  - [ ] Foreground/reconnect room-list resync payload is measurably smaller than a full
        `get_user_rooms` call (recorded).
  - [ ] `src/types/database.ts` regenerated; no manual edits.
  - [ ] Flag off → reconnect refetch behavior identical to today.

#### C2 — Per-user broadcast + unread counters

- **Scope:** §8 in full — `broadcast_message_to_participants` trigger + `user:${id}` private
  channel with RLS; `membership_changed` / `read_advanced` events; trigger-maintained unread
  counters + `get_user_rooms` rewrite (fixes B1, B9, B11). Runs **in parallel** with
  `global:messages` for one full release before the old channel is deleted (R2).
- **Flag:** `FEATURE_USER_BROADCAST`. **Dependencies:** C1 (rooms-delta is the resync
  fallback). **Complexity:** Med-High. **Effort:** 3–4 days. **Risk:** High (R2).
- **Success Criteria**
  - [ ] With the flag on, room-list previews and unread counts update with **no active
        subscription to `global:messages`** (network/socket inspection).
  - [ ] Parallel-run comparison in dev shows event parity between the old and new feeds over
        a scripted activity session (sends, joins, leaves, reads).
  - [ ] Preview updates trigger zero client-side profile lookups (sender name arrives in the
        payload; the LRU path is inert).
  - [ ] A second test user **cannot** subscribe to another user's `user:${id}` topic (RLS
        verified).
  - [ ] Trigger-maintained unread counters match a full `get_user_rooms` recompute after a
        mixed activity session (drift check, R9).
  - [ ] Flag off → old `global:messages` consumer restored instantly (overlap window).

#### C3 — Prefetch + presence channel

- **Scope:** §14 in full (top-rooms delta+hydrate prefetch, `onPressIn` hydrate, notification
  prefetch, image prefetch hooks) and the §8 presence upgrade replacing the 30 s
  `get_peer_profile` poll (fixes B10).
- **Flags:** `FEATURE_PREFETCH`, `FEATURE_PRESENCE_CHANNEL`. **Dependencies:** B1
  (hydrate primitive); delta-based prefetch activates after C1. **Complexity:** Low-Med.
  **Effort:** 1–2 days. **Risk:** Low.
- **Success Criteria**
  - [ ] After app start settles, opening any of the top `PREFETCH_TOP_ROOMS` rooms paints
        with zero blocking network requests.
  - [ ] Instrumentation confirms prefetch work never runs during an active scroll or
        animation (InteractionManager deferral verified).
  - [ ] DM header presence updates within ~5 s of the peer's state change; the 30 s polling
        path is inactive while the flag is on.
  - [ ] No measurable idle network/battery regression with prefetch enabled.
  - [ ] Flags off → no prefetch calls; presence reverts to polling.

---

### Complexity summary

| Phase | Milestone | Scope (summary) | Complexity | Est. effort | Risk |
|-------|-----------|-----------------|-----------|-------------|------|
| PREP | — | Native deps + builds, **zero behavior change** | Low-Med | 1–2 days | Med (R5) |
| A1 | A | Rendering quick wins (per-room loading, `getItemType`, room-list FlashList, deferred fetches) | Low | 1–2 days | Low |
| A2 | A | Pagination benchmark; page size configurable, benchmark-gated | Low | ~1 day | Low |
| A3 | A | Image pipeline (resize, thumbs, reserved boxes, prefetch) | Med | 2–3 days | Low |
| A4 | A | Scroll restoration (anchors + pill) | Med | 2 days | Low |
| A5 | A | Scroll-to-message (bidirectional window, `get_messages_around`) | **High** | 3–5 days | High (R4) |
| B1 | B | SQLite cache + hydrate-first rendering | **High** | 4–6 days | High (R1) |
| B2 | B | Outbox + offline UX | Med-High | 3–4 days | Med (R6) |
| C1 | C | Delta sync RPCs + integration | Med-High | 3–4 days | Med (R3) |
| C2 | C | `user:${id}` broadcast + unread counters | Med-High | 3–4 days | High (R2) |
| C3 | C | Prefetch + presence channel | Low-Med | 1–2 days | Low |

Total: **~24–36 focused dev-days**, deliverable one phase (= one PR) at a time per the
project's phase-gated migration convention.

---

## 20. Recommended Implementation Order

Milestones are thematic groupings; the *execution sequence* interleaves them along the
dependency graph:

```
A1 ──► A2 ──► PREP ──► B1 ──► C1 ──► B2 ──► C2
                │       │
                │       ├──► A4 (any time after B1)
                │       └──► C3 (after B1; delta-based prefetch activates after C1)
                └──► A3 (parallel-safe any time after PREP)

A5 last (after B1 + C1) — highest risk, nothing depends on it
```

Recommended sequence: **A1 → A2 → PREP → B1 → C1 → B2 → C2 → A3 → A4 → C3 → A5**
(A3 may run in parallel with B/C phases by a second contributor, since it touches disjoint
files).

Rationale:

1. **A1/A2 first** — pure wins with zero new dependencies; A2 also establishes the benchmark
   baseline that later phases are measured against, before any data-layer change muddies it.
2. **PREP is a hard gate** — no functional phase may bundle native-dependency installation;
   infrastructure preparation and functional implementation never share a PR.
3. **B1 (local cache) is the keystone** — B2/B3/B6 die here, and B2, C1, C3, A4, A5 are all
   thin layers over its primitives. It gets the largest single time-box, and its Success
   Criteria must fully pass before any dependent phase starts.
4. **B2 before C2** — offline correctness (user-facing trust) beats infra scaling (B1 the
   bottleneck) until user count actually presses on Realtime quotas; but C2 must land
   **before any growth push**.
5. **A5 last and optional-per-release** — it's the only phase that destabilizes the scroll
   engine; everything else ships without it.

Each phase = one PR = one feature flag = one rollback unit. Definition of done per phase:
all Success Criteria checked, flag on in dev, verified on Android device + web, flag on in
production build, previous code path removed only in the *following* release.


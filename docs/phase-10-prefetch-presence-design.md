# Phase 10 — Intelligent Prefetch & Push Presence Architecture (Design)

> **Status:** DESIGN ONLY. No code ships in this phase. Everything below is
> additive and gated behind two **independent** master flags —
> `FEATURE_INTELLIGENT_PREFETCH` (default `false`) and `FEATURE_PUSH_PRESENCE`
> (default `false`). With both off the app behaves byte-for-byte like today:
> rooms open on demand (page-1 fetch), media loads on scroll, and presence runs
> the existing 45s heartbeat + 30s peer poll. Rollback is flipping either flag
> back to `false`.

Talo is already offline-first: a bounded RAM cache backed by SQLite, an
incremental Sync Engine (delta lanes, cursors, coalescing, gap-overflow
fallback), a local FTS5 search index, scroll restoration anchors, and a durable
two-plane media pipeline. What it does **not** do is anticipate. Every room open
pays a cold page-1 round-trip; every image waits for the bubble to mount; a
peer's online status is discovered by polling on a timer. Telegram, by contrast,
feels instant because it *pre-warms* the things you are about to touch and
learns your online/offline state from a **pushed** connection, not a clock.

This phase designs two cooperating subsystems that sit *on top of* the existing
layers and never bypass them:

1. A centralized **Prefetch Scheduler** (`prefetchService`) — a single
   priority-driven, cancellable, concurrency-bounded, battery/network-aware work
   queue that speculatively warms rooms, messages, media, and the search index
   by **delegating to existing services** (`roomService`, `messageService`,
   `cacheService`, `syncService`, `searchService`, `Image.prefetch`). It issues
   no new Supabase queries of its own and owns no data — it only decides *what*
   to warm, *when*, and *in what order*, and it cancels aggressively.

2. A push-based **Presence Manager** (`presenceService` + `presenceStore`) that
   replaces the heartbeat/poll loops with a Supabase **Realtime Presence**
   channel: join/leave/sync events drive an in-memory presence store, the DB
   `user_presence` row is written only on state transitions (not on a timer),
   and "last seen" stays authoritative and privacy-gated through the existing
   `get_peer_profile` RPC.

Neither subsystem introduces a SQL migration, changes any service contract, or
touches message delivery, sync, outbox, media upload, or search ranking.

---

## Requirement → section map

| Brief item | Section |
|---|---|
| 1. Prefetch philosophy | §1 |
| 2. Room prefetch | §2 |
| 3. Message prefetch | §3 |
| 4. Media prefetch | §4 |
| 5. Search prefetch | §5 |
| 6. Presence architecture | §6 |
| 7. Presence state machine | §7 |
| 8. Scheduler | §8 |
| 9. Performance | §9 |
| 10. Interaction with existing systems | §10 |
| 11. Failure recovery | §11 |
| 12. Architecture diagram | §12 |
| 13. Design decisions & Telegram comparison | §13 |
| Architectural invariants | §14 |
| Rollout strategy | §15 |
| Implementation checklist | §16 |

---

## 0. Problem statement & scope

### What we have today (verified against the repository)

- **Room open is cold.** `useMessages` on mount calls `syncService.syncNow({ room })`;
  for a never-opened/evicted room that resolves to `fetchMessages` (page-1
  network fetch) before anything paints beyond whatever SQLite hydration
  provides. There is no speculative warming — the round-trip starts *after* the
  user has already navigated.
- **Media loads on demand.** The only prefetch that exists is
  `prefetchAlbumImages` in `chatStore.ts` (`src/stores/chatStore.ts:135`): when a
  page/delta is applied to a **resident** room it fires `Image.prefetch` for the
  newest `IMAGE_PREFETCH_COUNT` (10) image URLs — and only when
  `FEATURE_MEDIA_PIPELINE` is on. Nothing warms media for rooms you have *not*
  opened, nor thumbnails ahead of scroll.
- **Presence is polled.** `usePresenceHeartbeat` (`src/hooks/usePresence.ts:18`)
  upserts `user_presence.last_active_at` every `PRESENCE_HEARTBEAT_MS` (45s) while
  foregrounded; `usePeerPresence` polls `get_peer_profile` every
  `PEER_PRESENCE_POLL_MS` (30s) per open DM. The server treats a user online while
  `last_active_at` is within 75s. This is up to a 30s lag on "went offline" and a
  steady drip of RPCs per open conversation.
- **Realtime already exists** (`useRealtime.ts`): `room:${roomId}` (message/reaction/
  poll/participant events) and `global:messages` (list-level events), each with a
  3s reconnect (`RESUBSCRIBE_DELAY_MS`), a `hadDrop` recovery that calls
  `syncService`, and an `AppState` foreground resync that also pokes the outbox
  and media planes. Phase 10 presence reuses this exact channel-lifecycle idiom.
- **Sync is coalesced** (`syncService.ts`): one in-flight pull per resolved scope
  (`inFlight` map), bounded retry with a legacy fallback, cursors in `sync_state`.
  The scheduler must route *all* speculative room/message warming through here so
  it can never duplicate an in-flight sync.
- **Cache surface** (`cacheService.ts`): `getRooms`, `getRoomMessages`,
  `getRoomMessagesAround`, `saveMessages`/`saveMessagePage` (write-through +
  cursor advance), `getSyncState`/`setSyncState`, `mergeMessages`, `pruneRoom`.
  Prefetch reads/writes persistence **only** through these.
- **RAM caps** (`constants.ts`): `MESSAGE_WINDOW_SIZE=200`,
  `ROOM_CACHE_TRIM_SIZE=50`, `MAX_CACHED_ROOMS=8`, `MESSAGES_PER_PAGE=20`. These
  are the hard ceilings prefetch must respect — warming more rooms than
  `MAX_CACHED_ROOMS` into RAM would just churn the LRU.

### What we are adding

1. A **Prefetch Scheduler**: a module-level singleton (same shape as
   `syncService`/`outboxService`/`mediaService`) exposing a tiny imperative API
   (`schedule`, `cancel`, `cancelScope`, `poke`) and running a priority queue
   with concurrency limits, `InteractionManager`/idle gating, and
   network/battery awareness.
2. A set of **prefetch triggers** wired into existing lifecycle points (app
   launch, room-list render, `onPressIn` on a room row, notification receipt,
   scroll approaching a boundary, search focus). Triggers only *enqueue intent*;
   the scheduler decides execution.
3. A **Presence Manager**: `presenceService` (owns the Realtime Presence
   channel + DB last-seen writes) and `presenceStore` (Zustand, the reactive
   read model), replacing the two polling hooks with push semantics behind
   `FEATURE_PUSH_PRESENCE`.
4. A **presence state machine** driving both the local user's broadcast and the
   derived peer status shown in headers.

### Explicit non-goals

- No new SQLite table and **no migration**. `user_presence`, `privacy_settings`,
  and the existing RPCs are sufficient (§6.8).
- No change to delivery, sync, outbox, media upload, or search ranking.
- No global "presence for every user" fan-out. Presence is scoped to
  conversations you can actually see (open DM peers / group participants);
  everyone else falls back to durable last-seen (§6.2, §13.4).
- No prefetch of message **content the user cannot already see** (blocked users,
  rooms you are not a member of) — prefetch reuses the same RLS-backed services,
  so it can never widen access (§14 #4).
- No background-fetch OS task (BGTaskScheduler/WorkManager). "Background
  prefetch" here means *in-app, low-priority, idle-time* work, not OS-scheduled
  wakeups (§2.7, §13.6).

---

## 1. Prefetch Philosophy

### 1.1 Why prefetch exists

Perceived latency, not throughput, is the product problem. The offline-first
cache already makes a *previously opened* room instant; prefetch extends that
instant feeling to rooms and media the user is *about to* open, by moving the
network cost from "after the tap" to "before the tap, during idle time." The
goal is that the common navigation — open the app, tap the top conversation,
scroll a screen of history — never shows a spinner.

### 1.2 Guiding principles

1. **User-first, always.** Speculative work is strictly lower priority than
   anything the user is doing *right now*. A real navigation, a real send, an
   active-room sync, or a visible-media load always preempts prefetch. The
   scheduler yields the main thread via `InteractionManager.runAfterInteractions`
   and never awaits on a render path.
2. **Delegate, never duplicate.** Prefetch issues no new queries; it calls the
   same services the UI calls, so it automatically inherits RLS, coalescing
   (`syncService.inFlight`), cursors, and write-through caching. Two triggers for
   the same room collapse to one pull.
3. **Bounded and cancellable.** Every task is cheap to cancel and cheap to skip.
   Room switches, going offline, low battery, or memory pressure cancel
   in-flight speculative work immediately. Nothing prefetch does is ever
   load-bearing for correctness — cancelling it only means the old on-demand path
   runs.
4. **Respect the existing ceilings.** Prefetch warms at most `MAX_CACHED_ROOMS`
   into RAM and never more than the resident window per room; disk stays bounded
   by the existing `pruneRoom`/`MAX_PERSISTED_PER_ROOM` and media LRU budgets.
5. **Predict cheaply.** Prediction signals are local and free: room-list order
   (already recency/bookmark-sorted), pinned/bookmarked flags, a lightweight
   open-frequency counter, and `onPressIn`. No ML, no server hints.
6. **Invisible on failure.** A failed or cancelled prefetch produces no user-
   visible error and no state change — the room simply loads on demand as it does
   today (graceful degradation, §11).

### 1.3 What SHOULD be prefetched

| Target | Why | Tier |
|---|---|---|
| Newest message window of the top-N recent rooms | Highest open probability; makes the first tap instant | HIGH |
| Newest window of pinned/bookmarked rooms | Explicit user intent to keep them handy | HIGH |
| The room under `onPressIn` (before `onPress` fires) | ~100–200ms of free lead time per tap | CRITICAL |
| Notification target room | User is very likely to open it | CRITICAL |
| Inline micro-thumbnails already embedded in attachments JSON | ~1 KB each, already in the row — zero extra fetch | NORMAL |
| Full images for the newest album/image messages of warmed rooms | Removes the on-scroll load flash | NORMAL |
| Search-index warming (repair pass) on idle | Makes first search instant/offline | LOW |
| Avatar images for the visible room list | Small, high reuse | LOW |
| Emoji sprite/data assets | One-time, high reuse in composer | IDLE |

### 1.4 What should NEVER be prefetched

- **Full-resolution videos and large files.** Bandwidth- and disk-expensive, low
  open probability. Only their thumbnails/poster frames are warmed; the file
  itself downloads on tap through the existing media-download path.
- **Older history for rooms the user has not opened.** Only the newest window is
  a candidate; deep backscroll is user-driven paging.
- **Anything on a metered/cellular connection by default** beyond tiny payloads
  (thumbnails already in-row, avatars). Media prefetch is Wi-Fi-gated unless the
  user opts in (§4.6, §8.7).
- **Content requiring a *new* access scope.** Prefetch never queries a room the
  user is not a participant of, never bypasses block filters — it can only warm
  what the on-demand path could already fetch.
- **On low battery / power-save mode** — all non-critical tiers suspend (§8.6).
- **While the user is actively interacting** (scrolling, typing) — deferred until
  interactions finish (§8.4).

### 1.5 User-first scheduling (summary)

The scheduler is a *background citizen*. Concretely: (a) tasks run only
`runAfterInteractions`; (b) CRITICAL tasks (onPressIn / notification) may run
promptly but still off the render commit; (c) all lower tiers wait for an idle
gap; (d) any real user navigation calls `prefetchService.cancelScope(...)` for
rooms other than the target, freeing bandwidth for the room actually being
opened. See §8.

### 1.6 Battery & data considerations (summary)

Prefetch reads `AppState` (only foreground/inactive is eligible — no OS
background wakeups), `NetInfo` (offline ⇒ suspend; cellular ⇒ data-only tiers),
and battery/low-power state (`expo-battery`) to suspend non-critical tiers when
the device is in power-save or below a low-battery threshold. Details in §8.6–§8.7.

---

## 2. Room Prefetch

"Warming a room" = ensuring its newest message window is resident in SQLite (and
optionally in RAM) so `useMessages` mount paints instantly and its
`syncService.syncNow({ room })` resolves to a cheap delta instead of a cold page
fetch. All warming routes through `syncService`/`cacheService`, so it is
coalesced and cursor-correct.

### 2.1 App launch

On the first authenticated render (root layout, after the room list is available
from `roomStore.fetchRooms` hydrate-first paint), enqueue a **HIGH** batch to
warm the newest window of the top `PREFETCH_ROOM_WARM_COUNT` (proposed **5**)
rooms by list order. The list is already sorted bookmarked-first then by
`last_message_at`, so "top 5" is the best cheap predictor. Launch warming is
gated behind `runAfterInteractions` so it never competes with first paint or the
initial `global:messages` subscribe.

### 2.2 Recent rooms

The room-list order *is* the recency signal (no new query). The warm set is the
first `PREFETCH_ROOM_WARM_COUNT` rooms; as the list re-sorts on new messages, the
warm set is recomputed and the scheduler diffs it — newly-hot rooms are enqueued,
rooms that dropped out have their pending (not-yet-started) tasks cancelled.

### 2.3 Frequently opened rooms

A tiny **local** open-frequency model augments pure recency: `roomOpenStats` —
a persisted `Record<roomId, { count, lastOpenedAt }>` (Zustand + AsyncStorage,
mirrors `draftStore`), incremented in `useMessages` mount. The warm-set selector
blends recency and frequency (e.g. keep the top-N by `last_message_at`, plus up
to 2 "frequent but not recent" rooms). This is device-local, never synced,
disposable, and capped (LRU by `lastOpenedAt`). No server, no ML.

### 2.4 Pinned / bookmarked rooms

`bookmarked_at` is already on `RoomWithLastMessage`. Bookmarked rooms are always
included in the warm set (explicit intent), independent of recency, subject to
the same `MAX_CACHED_ROOMS` RAM ceiling (they warm SQLite even if not resident in
RAM).

### 2.5 Notification target room

When a push notification is received/opened (`notificationService`), enqueue a
**CRITICAL** warm for its `roomId` *before* navigation completes, so by the time
the chat screen mounts the window is already in cache. This is the highest-value
predictor (the user is opening exactly that room) and is exempt from the idle
gate (but still off the render commit).

### 2.6 Room press (`onPressIn`)

The strongest cheap signal. On a room row's `onPressIn` (fires on touch-down,
before `onPress`/navigation), enqueue a **CRITICAL** warm for that room with a
short debounce. The ~100–200ms between touch-down and navigation commit is free
lead time. If the press is cancelled (scroll steal, drag-off), the task is
cancelled via `cancelScope('press')`. Because warming is idempotent and coalesced,
a press that *does* open the room simply finds the pull already in flight and
`useMessages` awaits the same promise.

### 2.7 Background prefetch (in-app idle)

"Background" = the app is foregrounded but the user is idle (no active
interaction, list at rest). During these gaps the scheduler drains LOW/IDLE tiers
(search-index repair, avatar/emoji warming, extending the warm set). It does
**not** register an OS background task; when the app is truly backgrounded
(`AppState !== 'active'`) the scheduler pauses entirely (§8.6) — consistent with
how the heartbeat and peer poll pause today.

### 2.8 Warm-cache strategy & hydration interaction

Warming a room performs, in order (all via existing APIs):

1. `cacheService.getRoomMessages(roomId, N)` to check if a usable window is
   already on disk. If a fresh window exists and the room has a sync cursor, the
   room is "warm enough" — skip network, done.
2. Otherwise route to `syncService.syncNow({ room })`. Per `syncService`'s own
   logic this is a delta if resident+cursor, else a page-1 fetch that paints,
   hydrates SQLite, and seeds the cursor — exactly the path a real open would
   take, just earlier.

This means prefetch and real-open share one code path and one cursor. Hydration
(the cache→RAM paint) is unchanged: prefetch only guarantees the *disk* window
exists; the RAM paint still happens in `useMessages`/`chatStore` on actual open,
so we never hold RAM for rooms the user hasn't entered beyond the optional
top-1 RAM warm (§2.9).

### 2.9 Memory limits

- SQLite warming is cheap and bounded by `pruneRoom`/`MAX_PERSISTED_PER_ROOM`.
- **RAM** warming (calling `setRoomMessages` for a not-yet-opened room) is
  restricted to at most the **single** most-likely room (top of warm set, or the
  `onPressIn`/notification target) to respect `MAX_CACHED_ROOMS=8` and avoid LRU
  churn. Everything else warms disk only. This keeps the RAM working set
  identical in character to today (only rooms you actually visit stay resident).

---

## 3. Message Prefetch

All message warming is **window-bounded** (never unbounded backfill) and routes
through `messageService`/`cacheService`/`chatStore` so dedup, server-wins merge,
sort, and caps are inherited.

### 3.1 Newest messages

Covered by room warming (§2.8): the newest `MESSAGES_PER_PAGE`/window is the unit
of warming. This is the default and the only *speculative* message prefetch.

### 3.2 Older history (pagination interaction)

Not speculatively warmed for cold rooms. For the **active** room, the scheduler
may *pre-page*: when the user scrolls within a threshold of the top boundary
(before `onStartReached` fires), enqueue a **NORMAL** `loadMore` one page ahead,
so history is already present when the trigger fires. This reuses the exact
`useMessages.loadMore` cursor logic (oldest resident `created_at`), is cancelled
on room switch, and is a no-op when `hasMore` is false. It never fetches more
than one page ahead (bounded look-ahead, §9 maximum-concurrency).

### 3.3 Around a search result

When search focus navigation occurs (Phase 9 `?focus=&at=`), the scheduler warms
the **around-window** via the existing `cacheService.getRoomMessagesAround`
(already added in Phase 9) so the jump target and its neighbors are resident
before the Scroll Manager performs the jump. If the around-window isn't on disk,
warming falls back to the server page around that timestamp through the normal
service path. This makes search→message feel instant.

### 3.4 Reply target

When a message with a `reply_to` is rendered near the viewport, the scheduler may
warm the referenced parent message if it is outside the resident window (so
tapping the reply preview to jump is instant). Bounded to referenced ids visible
in the current window; deduped; cancelled on room switch. This is a NORMAL/LOW
tier and purely opportunistic.

### 3.5 Jump target

Any programmatic jump (search, reply, future deep links) declares its target to
the scheduler, which ensures the around-window is warm (§3.3) and then hands off
to the Phase 9 Scroll Manager for the actual scroll. Prefetch owns *data
residency*; the Scroll Manager owns *scroll position*. Clean separation.

### 3.6 Unread region

When a room has unread messages below the restored anchor (Phase 9), the
scheduler ensures the unread region between the anchor and newest is resident
(it usually is, since it's within the newest window). If unread spans beyond the
window (large backlog), only the newest window is warmed; the "N new messages"
pill jump then pages as needed. No unbounded unread backfill.

---

## 4. Media Prefetch

Media prefetch has two independent concerns: **which** assets to warm (priority)
and **where** they land (expo-image's disk+memory cache, or the media-download
cache for videos/files). It extends the existing `prefetchAlbumImages` hook
rather than replacing it.

### 4.1 Images

For a warmed room's newest image/album messages, `Image.prefetch(urls)` warms
expo-image's disk+memory cache (exactly what `prefetchAlbumImages` does today for
resident rooms). Phase 10 extends this to: (a) the top-1 RAM-warmed room even
before open, and (b) images approaching the viewport in the active room
(look-ahead by a few rows via the Phase 9 `onViewableItemsChanged` signal).
Bounded by `IMAGE_PREFETCH_COUNT` per batch.

### 4.2 Albums

Album attachments are already grouped in one message's `attachments` JSON; the
existing helper iterates them. Prefetch warms the album's images in order,
thumbnail-first (§4.6), capped by the per-batch limit so a 10-image album can't
monopolize the media lane.

### 4.3 Videos

Never full-prefetched (§1.4). Only the **poster/thumbnail** (the inline micro-
thumbnail in `attachments`, or a first-frame image URL if present) is warmed via
`Image.prefetch`. The video file downloads on tap through the existing
media-download cache path with its `MEDIA_DOWNLOAD_CACHE_MAX_BYTES` LRU budget.

### 4.4 Avatar images

Room-list and participant avatars are small and high-reuse. For the visible room
list, `Image.prefetch` the avatar URLs at LOW priority. Bounded to visible +
a small look-ahead; deduped by URL.

### 4.5 Emoji assets

The emoji picker's sprite/data assets are warmed once at IDLE priority after
launch (so first composer emoji open is instant). One-shot per session; guarded
by a "already warmed" flag.

### 4.6 Thumbnail-first strategy

Every image target warms in two stages: (1) the inline micro-thumbnail
(`MEDIA_THUMB_EDGE`, ~1 KB, already in the row → *zero* network) gives an instant
blur-up; (2) the full image warms only if the room is in the top warm set and the
network permits. This mirrors Telegram's progressive image loading and keeps
cellular data usage near zero for the common case.

### 4.7 Priority rules

```
CRITICAL : (none for media — media is never user-blocking)
HIGH     : full images of the active room's visible + near-viewport messages
NORMAL   : full images of the top-1 warmed room; album images of warmed rooms
LOW      : avatars of the visible room list; reply-target thumbnails
IDLE     : emoji assets; avatars beyond the fold
```

Media tiers always sit **below** the equivalent data tier — message text must
warm before its images.

### 4.8 Disk cache interaction

expo-image owns its own disk cache (images); the media pipeline owns the
video/file download cache (`cacheDirectory`, LRU-swept to
`MEDIA_DOWNLOAD_CACHE_MAX_BYTES`). Prefetch never writes either directly — it
calls `Image.prefetch` (images) and, for the rare warmed poster that isn't a
data-URI, lets expo-image handle it. Video/file bytes are out of scope for
prefetch, so their LRU budget is unaffected.

### 4.9 Memory cache interaction

`Image.prefetch` populates expo-image's memory cache lazily on decode; to avoid
decode pressure we prefetch **URLs** (disk warm), not forced decodes. Decode
still happens on mount as today. This keeps the JS/native memory footprint of
prefetch near zero — we are warming bytes on disk, not bitmaps in RAM.

### 4.10 Cancellation strategy

Media tasks are the first cancelled on any pressure signal (room switch, offline,
cellular, low battery, memory warning). `Image.prefetch` cannot be hard-aborted,
but the *scheduling* is: queued media tasks are dropped, and we never enqueue
more than the concurrency cap, so at most `PREFETCH_MEDIA_MAX_CONCURRENT`
(proposed **2**) prefetches are ever in flight. That bounds the wasted bytes of a
cancel to two in-flight images.

---

## 5. Search Prefetch

The Phase 8 local FTS5 index makes search instant *once built*. Phase 10 ensures
it is built and warm before the user searches, and that likely queries resolve
without a cold read.

### 5.1 Search-index warming (repair pass)

Phase 8's boot coverage-repair (`SEARCH_REPAIR_BATCH`) re-indexes missing/stale
rows in chunks. The scheduler owns *when* those chunks run: at LOW/IDLE priority,
`runAfterInteractions`, a few hundred rows per idle gap, so a large cache never
blocks first paint and the index reaches full coverage during the first idle
window instead of on first search.

### 5.2 Recent searches

A small persisted list of recent query strings (device-local, capped) lets the
scheduler *pre-run* the top recent query against the warm index at IDLE priority
and cache its result set in RAM, so re-opening search and repeating a common
query is instant. Purely a latency optimization; never shown proactively.

### 5.3 Frequently opened conversations

The same `roomOpenStats` (§2.3) scopes search warming: the FTS rows for
frequently-opened rooms are prioritized in the repair pass, so search within your
most-used conversations is covered first.

### 5.4 Lazy loading & cold startup

On cold start the index may be empty/partial. Search remains **fully functional**
without prefetch: `FEATURE_LOCAL_SEARCH` off ⇒ server RPC; on but index cold ⇒
service falls back to server/LIKE scan (Phase 8 behavior). Prefetch only shortens
the window before local search is fully warm — it is never a prerequisite.

---

## 6. Presence Architecture (push-based)

Replace the 45s heartbeat + 30s poll with a **Supabase Realtime Presence**
channel. Presence gives push join/leave/sync events, so "went offline" is known
within seconds (socket close) instead of up to 30s later, and open conversations
stop polling entirely.

### 6.1 Presence channel

Presence is **scoped to conversations you can see**, not global. Two options,
and the chosen design:

- **Per-conversation presence channel.** Extend the *existing* `room:${roomId}`
  channel (already subscribed while a chat is open) with a Presence extension:
  each participant `channel.track({...})` on subscribe. Peers in that room
  receive `presence` sync/join/leave. This needs **no new channel** — it rides
  the socket the chat screen already opens.

  This is the primary design: presence lives on the room channel, so it exists
  exactly while a conversation is open and is torn down with it — matching the
  privacy stance that presence is only shared inside an active shared context.

### 6.2 Tracked payload & multi-scope

Each client tracks a compact meta on the room channel:

```ts
// design shape — one meta per (user, device) on a room presence channel
interface PresenceMeta {
  user_id: string;
  device_id: string;      // stable per install (for multi-device de-dup)
  state: "online" | "away";
  last_active_at: string; // ISO — advances on activity, drives "away"
  // NOTE: a user who hid presence tracks NOTHING (source-side privacy, §6.9)
}
```

For the **room list** (where we don't hold a socket per room), we do *not* use
live presence — that would mean N channels. The list shows durable "last seen"
from `user_presence` via the existing profile/room payloads, refreshed on the
normal room-list sync. Live presence is a *conversation* feature. (This is the
key scalability decision, §13.4.)

### 6.3 Join

On chat-screen subscribe (the existing `room:${roomId}` `.subscribe` callback,
status `SUBSCRIBED`), if `FEATURE_PUSH_PRESENCE` and the user's
`online_visibility` allows it, call `channel.track(meta)` with `state: "online"`.
The peer receives a `presence` `join` event and updates `presenceStore`
immediately — no poll, no lag.

### 6.4 Leave

On chat-screen unmount (channel removal) Realtime emits a `leave` for that
client's metas automatically; peers see the user drop from the room's presence
set. Before teardown, `presenceService` writes the durable `user_presence.last_active_at`
(one upsert on transition) so the peer's *next* view shows an accurate "last
seen" even though the live channel is gone.

### 6.5 Reconnect

Reuses `useRealtime`'s existing reconnect machinery: on `CHANNEL_ERROR`/
`TIMED_OUT` the channel is torn down and re-subscribed after `RESUBSCRIBE_DELAY_MS`
(3s) with backoff. On the fresh `SUBSCRIBED`, `presenceService` re-`track`s.
While disconnected the local state machine is `Reconnecting` (§7); peers see the
user as offline after the socket closes (correct — they truly can't reach us).

### 6.6 Heartbeat (activity refresh, not a poll)

There is no network poll. A lightweight **activity timer** updates the *local*
`last_active_at` and re-`track`s only when it changes state (online→away). "Away"
is derived from inactivity (`PRESENCE_AWAY_MS`, proposed **60s** with no
interaction) — a re-track carries `state: "away"`. This is at most one track
call per state change, versus a fixed 45s upsert today. The DB row is written on
transition (online→away→offline), not on a timer.

### 6.7 Timeout & offline detection

Two independent detectors:

- **Socket-level (push):** Realtime removes a client's presence metas on
  disconnect → peers get a `leave` within the server's presence timeout (seconds).
  This is the primary, fast path.
- **Activity-level (local):** the away timer degrades our own broadcast to
  "away" after inactivity, and to offline on background (§7). This is what makes
  "away" meaningful even while the socket stays open.

### 6.8 Last seen (durable, privacy-gated)

`user_presence.last_active_at` remains the durable last-seen store, but is now
written on **transitions** (join/away/leave/background) instead of every 45s —
far fewer writes. Reading a peer's last-seen for the header/room-list stays on
the **existing** `get_peer_profile` RPC, which already applies the owner's
`online_visibility` server-side (RLS). So privacy authority is unchanged; only
the *online now* signal moves from poll to push.

### 6.9 Presence consistency & privacy

- **Source-side privacy.** A user who disabled presence visibility simply does
  **not** `track` on the channel (or tracks a neutral meta with no `state`). Peers
  therefore never receive an "online" for a hidden user — privacy is enforced at
  the broadcaster, and `get_peer_profile` continues to gate last-seen. No client
  is trusted to hide someone else's status.
- **Consistency model.** The `presenceStore` is derived state: `online` if any
  live meta for that user has `state:"online"`; `away` if metas exist but all are
  away; otherwise fall back to durable last-seen. Presence sync events are the
  source of truth while a room is open; on leave/close we revert to last-seen.
- **Group rooms.** Presence set = the union of tracked participants currently in
  the room channel; the header can show "N online" from `presenceStore` without
  N polls.

### 6.10 Multiple devices

Presence is keyed by `(user_id, device_id)`; Realtime holds one meta list per
presence ref. A user online on any device ⇒ online. `last_seen` = max
`last_active_at` across their metas. Two devices of the same user in the same
room produce two metas that collapse to one online status in `presenceStore`.

### 6.11 Failure recovery (presence)

- Channel error/timeout ⇒ `Reconnecting`, backoff re-subscribe, re-track on
  success (§6.5).
- App background ⇒ untrack/close (state `Background`), write last-seen; on
  foreground re-subscribe + re-track (mirrors today's `AppState` gating).
- Realtime unavailable entirely (feature disabled server-side, or flag off) ⇒
  `FEATURE_PUSH_PRESENCE=false` path: the existing heartbeat/poll hooks run
  exactly as today. The two implementations are mutually exclusive by flag.

---

## 7. Presence State Machine

One machine drives the **local** user's broadcast; the derived **peer** status
shown in the UI is a projection of received presence metas + last-seen fallback.

### 7.1 States (local broadcast)

| State | Meaning | Broadcast |
|---|---|---|
| `Offline` | No network / not signed in | nothing tracked |
| `Connecting` | Channel subscribing (first attempt) | not yet tracked |
| `Online` | Foregrounded, socket joined, recently active | `track(state:"online")` |
| `Away` | Foregrounded, socket joined, inactive ≥ `PRESENCE_AWAY_MS` | `track(state:"away")` |
| `Background` | App not `active` | untracked (durable last-seen written) |
| `Disconnected` | Socket dropped unexpectedly | nothing (peers see leave) |
| `Reconnecting` | Backoff re-subscribe after a drop | not tracked until joined |

### 7.2 Transition rules

```
[start signed-in] ─────────────────────────────► Connecting
Connecting ── SUBSCRIBED ──────────────────────► Online   (track online)
Connecting ── CHANNEL_ERROR/TIMED_OUT ─────────► Reconnecting
Online ── inactivity ≥ AWAY_MS ────────────────► Away      (re-track away)
Away ── any interaction ───────────────────────► Online    (re-track online)
Online/Away ── AppState ≠ active ──────────────► Background (untrack + last-seen)
Background ── AppState = active ───────────────► Connecting (re-subscribe/re-track)
Online/Away ── socket drop ────────────────────► Disconnected
Disconnected ── after RESUBSCRIBE_DELAY_MS ────► Reconnecting
Reconnecting ── SUBSCRIBED ────────────────────► Online    (re-track online)
Reconnecting ── NetInfo offline ───────────────► Offline
any ── NetInfo offline ────────────────────────► Offline
Offline ── NetInfo online + signed-in ─────────► Connecting
any ── sign-out ───────────────────────────────► Offline   (untrack + last-seen)
```

- **Activity** = touch/scroll/typing/foreground; resets the away timer.
- Transitions that leave a "reachable" state (`Background`, `Disconnected`,
  `Offline`, sign-out) always write durable last-seen once, so peers get an
  accurate timestamp.
- Peer projection: `Online` if any received meta is online; else `Away` if metas
  exist; else render last-seen text from `get_peer_profile`.

---

## 8. Scheduler

A single module-level singleton `prefetchService` (no React, same idiom as
`syncService`). It is the only place that decides execution order and
concurrency. Triggers call `schedule(task)`; the scheduler does the rest.

### 8.1 Task shape & priority queue

```ts
// design shape
type PrefetchTier = "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | "IDLE";

interface PrefetchTask {
  key: string;        // dedup id, e.g. `room:${id}` / `media:${url}` / `search:repair`
  scope: string;      // cancellation group, e.g. `press` / `launch` / `room:${id}`
  tier: PrefetchTier;
  run: (signal: AbortSignal) => Promise<void>; // delegates to existing services
}
```

A single priority queue ordered by tier then FIFO within a tier. `schedule`
de-dupes by `key` (a queued/in-flight task with the same key is not re-added).
The queue is drained by a pump that respects concurrency (§8.3) and the
run-gates (§8.4).

### 8.2 Cancellation

Each task carries an `AbortSignal`; `cancel(key)` and `cancelScope(scope)` abort
matching tasks. For network delegation, abort propagates where the underlying
API supports it; where it doesn't (`Image.prefetch`, an in-flight `syncNow`),
cancellation means the *result is discarded and no follow-on work is scheduled*
— the in-flight call completes harmlessly (and `syncNow` is coalesced, so a real
open reuses it). Room switch calls `cancelScope('press')` and cancels other
rooms' speculative tasks.

### 8.3 Concurrency limits

- Data lane: `PREFETCH_MAX_CONCURRENT` (proposed **2**) concurrent room/message
  warms.
- Media lane: `PREFETCH_MEDIA_MAX_CONCURRENT` (proposed **2**) concurrent
  `Image.prefetch` batches.
- The lanes are independent so a slow image never blocks a text warm, but their
  combined footprint is small and both sit below the user's own traffic.

### 8.4 InteractionManager & avoid blocking UI

Every non-CRITICAL task runs inside `InteractionManager.runAfterInteractions`, so
active gestures/animations always finish first. CRITICAL tasks (onPressIn,
notification) are allowed to start immediately but still asynchronously (never on
the synchronous render/commit path). The pump yields between tasks so a long
queue can't monopolize the JS thread.

### 8.5 Idle scheduling

LOW/IDLE tiers drain only during idle gaps: after `runAfterInteractions`
resolves *and* a short quiet debounce (`PREFETCH_IDLE_DELAY_MS`, proposed
**400ms** of no scheduling churn). This is the "background prefetch" window
(§2.7): search-index repair, avatar/emoji warming, warm-set extension.

### 8.6 Background & battery awareness

- **AppState:** on `!== 'active'` the pump pauses and CRITICAL-only draining
  stops; on `active` it resumes. Matches the existing presence/poll gating.
- **Battery:** via `expo-battery`, if low-power mode is on **or** battery
  `< PREFETCH_LOW_BATTERY_PCT` (proposed **20%**) and unplugged, suspend
  NORMAL/LOW/IDLE tiers (HIGH/CRITICAL still run — they're user-imminent).

### 8.7 Network awareness

Via `@react-native-community/netinfo` (or the project's existing connectivity
signal): **offline** ⇒ suspend all tiers (nothing to fetch; on reconnect the pump
resumes and re-evaluates the warm set). **Cellular/metered** ⇒ suspend media
full-image and video-poster tiers (thumbnails already in-row and avatars still
allowed); data warms (small) still run unless the user opts out. **Wi-Fi** ⇒ all
tiers eligible.

### 8.8 Public API (design)

```ts
// design surface — imperative, no React, fire-and-forget
prefetchService.schedule(task: PrefetchTask): void;
prefetchService.cancel(key: string): void;
prefetchService.cancelScope(scope: string): void;
prefetchService.poke(reason): void; // re-evaluate warm set (reconnect/foreground/list change)
prefetchService.pause() / resume(): void; // driven by AppState/NetInfo/battery
```

`poke` is called from the same places `outboxService.poke()`/`mediaService.poke()`
already are (the `useRealtimeRooms` `deltaResync`), so reconnect/foreground
re-warm rides existing wakeups.

---

## 9. Performance

| Concern | Design guarantee |
|---|---|
| **CPU** | Tasks yield via `InteractionManager`; the pump processes one→next with yields; no synchronous loops over large arrays on the JS thread. |
| **Memory** | RAM warming capped to 1 extra room (§2.9); media warmed as disk bytes not decoded bitmaps (§4.9); `roomOpenStats`/recent-searches LRU-capped. |
| **Battery** | Suspends non-critical tiers in power-save/low-battery; pauses entirely in background; presence drops 45s timer writes to transition-only writes. |
| **Disk IO** | Warming reuses `cacheService` write-through (same writes a real open makes); `pruneRoom`/`MAX_PERSISTED_PER_ROOM` and media LRU budgets unchanged. |
| **Network** | Coalesced through `syncService.inFlight` (no duplicate pulls); media Wi-Fi-gated; thumbnail-first keeps cellular near zero; presence removes the per-room 30s poll drip. |
| **Cancellation** | `AbortSignal` per task; room switch/offline/battery cancel scopes; in-flight uncancellable calls are simply discarded, never load-bearing. |
| **Duplicate prevention** | Dedup by `key` in the queue **and** coalescing in `syncService`; two triggers → one pull. |
| **Maximum concurrency** | Hard caps: 2 data + 2 media in flight; 1-page look-ahead for pre-paging; ≤`IMAGE_PREFETCH_COUNT` per media batch. |
| **Priority inversion** | Media tiers strictly below their data tier; a queued CRITICAL always jumps ahead of running-LOW at the *next* dispatch (LOW tasks are short/chunked so head-of-line blocking is bounded). |

### 9.1 Duplicate-work elimination (the central perf story)

The single most important property: **prefetch cannot duplicate real work.**
Because every speculative room/message warm calls `syncService.syncNow`, and
`syncNow` coalesces per scope, a prefetch already in flight for `room:X` is the
*same promise* a real open awaits. Likewise media dedups by URL and `Image.prefetch`
is a no-op for already-cached URLs. The scheduler's queue-level dedup is a second
guard on top of the service-level coalescing.

### 9.2 Presence write reduction

Today: 1 upsert / 45s / foreground device = ~80 writes/hour/device. Phase 10:
writes only on transition (join/away/background/leave) — typically a handful per
session. Peer online is push (0 polls) vs 120 RPCs/hour/open-DM today.

---

## 10. Interaction with Existing Systems

No duplicated work; every integration is a *delegation* or a *shared signal*.

| System | Interaction |
|---|---|
| **SQLite cache** | Prefetch reads/writes **only** via `cacheService`; warming a room is the same write-through a real open performs. No direct `src/db/*` access. |
| **Incremental Sync** | Room/message warms call `syncService.syncNow` → inherits delta lanes, cursors, gap-overflow fallback, and coalescing. Prefetch never re-implements sync. |
| **Realtime** | Presence rides the existing `room:${roomId}` channel + lifecycle; prefetch `poke` rides the existing `deltaResync` reconnect/foreground wakeup alongside `outboxService`/`mediaService`. |
| **Search** | Scheduler owns *when* the Phase 8 repair batches run (idle); it never changes indexing logic or ranking. |
| **Scroll Restoration** | Prefetch guarantees the around-window is resident for a jump (§3.3) then hands off to the Phase 9 Scroll Manager for the scroll. Data residency vs scroll position are cleanly separated. |
| **Message rendering** | Unchanged. Warming only populates cache/`Image.prefetch`; the render path (MessageList/FlashList/MessageBubble) is untouched. |
| **Media pipeline** | Extends the existing `prefetchAlbumImages`/`Image.prefetch` hook; upload planes and download-cache LRU are untouched. |
| **Room switching** | `setActiveRoom` (chatStore) already trims/evicts; the scheduler additionally `cancelScope`s the left room's speculative tasks and re-targets the warm set at the entered room's neighbors. |
| **FlashList** | The Phase 9 `onViewableItemsChanged`/`onScroll` signals feed message pre-paging (§3.2) and near-viewport image warming (§4.1) — reusing hooks already added, no new list props. |
| **Presence hooks** | `FEATURE_PUSH_PRESENCE` on ⇒ `presenceStore` replaces `usePeerPresence` polling and the `usePresenceHeartbeat` interval; off ⇒ today's hooks run unchanged. |

---

## 11. Failure Recovery

| Scenario | Behavior |
|---|---|
| **Network lost** | Scheduler `pause()`s all tiers; presence → `Offline` (peers see leave). No errors surfaced. On reconnect, `poke` re-warms and presence re-subscribes/re-tracks. |
| **Prefetch cancelled** | Task aborted or discarded; the room/media loads on demand exactly as today. No state change, no user-visible effect. |
| **Presence timeout** | Socket drop → `Disconnected` → backoff `Reconnecting`; peers fall back to durable last-seen until we re-join. |
| **Reconnect** | Existing `RESUBSCRIBE_DELAY_MS` backoff; on `SUBSCRIBED`, re-track presence and `poke` prefetch (rides `deltaResync`). |
| **Cold start** | Warm set computed after hydrate-first room-list paint; index repair drains on idle; nothing blocks first paint. Search/presence fully functional before warming completes. |
| **App restart** | `roomOpenStats`/recent-searches/anchors rehydrate from AsyncStorage; SQLite warm windows persist; RAM warm is rebuilt lazily on open. Presence starts fresh at `Connecting`. |
| **Cache eviction** | LRU eviction (`MAX_CACHED_ROOMS`) is expected; an evicted warm room just re-warms on next `poke`/open. `pruneRoom` keeps disk bounded. |
| **Graceful degradation** | Both flags off (or Realtime/battery/network hostile) ⇒ the app is exactly today's app. Prefetch and push-presence are pure accelerators, never correctness dependencies. |

---

## 12. Architecture Diagram

```
                         ┌───────────────────────────────────────────────┐
                         │                   Screens                      │
                         │  RoomList (onPressIn)  Chat  Search  Notif tap  │
                         └───────┬───────────────┬───────────────┬────────┘
             schedule/cancel/poke│               │track/untrack  │warm target
                                 ▼               ▼               ▼
      ┌───────────────────────────────┐   ┌──────────────────────────────┐
      │      Prefetch Scheduler        │   │       Presence Manager        │
      │  (prefetchService singleton)   │   │ presenceService + presenceStore│
      │  • priority queue (5 tiers)    │   │  • per-room presence channel   │
      │  • dedup by key                │   │  • join/leave/sync → store     │
      │  • AbortSignal cancellation    │   │  • state machine (§7)          │
      │  • 2 data + 2 media concurrency│   │  • transition-only last-seen   │
      │  • InteractionManager + idle   │   │                                │
      │  • battery / network gates     │   │                                │
      └───┬───────┬───────┬───────┬────┘   └───────┬───────────────┬───────┘
   syncNow│  cache│ Image.│ search│ repair          │track on        │last-seen
          │  reads│prefetch│              room channel│ SUBSCRIBED     │ read (RLS)
          ▼       ▼       ▼       ▼                  ▼                ▼
   ┌────────────┐ ┌──────────┐ ┌────────────┐  ┌──────────────┐ ┌──────────────┐
   │ Sync Engine│ │cacheServ.│ │searchService│  │  Realtime     │ │get_peer_profile│
   │(coalesced) │ │(SQLite)  │ │ (FTS5 index)│  │room:${roomId} │ │  RPC (privacy) │
   └─────┬──────┘ └────┬─────┘ └─────────────┘  │+ presence ext │ └──────┬───────┘
         │             │                        └───────┬───────┘        │
         ▼             ▼                                 │                ▼
   ┌──────────────────────────┐                          │        ┌──────────────┐
   │  SQLite  +  Network Layer │◄─────────────────────────┘        │ user_presence│
   │  (Supabase, RLS)          │      Media Cache (expo-image disk) │  (last_seen) │
   └──────────────────────────┘      FlashList (viewability signals)└──────────────┘

   InteractionManager gates every non-CRITICAL task off the render path.
   Both subsystems are inert when their master flag is false.
```

---

## 13. Design Decisions & Trade-offs

### 13.1 A single scheduler singleton (not per-screen prefetch)

**Decision:** one `prefetchService` module singleton, matching
`syncService`/`outboxService`/`mediaService`. **Why:** global priority and
concurrency can only be enforced from one place; per-screen prefetch would race,
duplicate, and have no cross-room cancellation. **Trade-off:** a global singleton
is harder to unit-isolate, mitigated by the pure task shape and injectable
delegates.

### 13.2 Delegate to services, issue no queries

**Decision:** prefetch never calls Supabase directly; it calls
`syncService`/`cacheService`/`messageService`/`searchService`/`Image.prefetch`.
**Why:** inherits RLS, coalescing, cursors, caps, and write-through for free, and
makes "prefetch can't duplicate real work" a structural property (§9.1). **Trade-off:**
prefetch is bounded to what those services expose (e.g. no custom "warm 3 pages"
query) — acceptable, since window-bounded warming is the whole philosophy.

### 13.3 Predict with local signals only

**Decision:** recency (list order) + bookmarked flag + a tiny local
open-frequency counter + `onPressIn`. **Why:** free, private, no server, no ML,
and already ~90% of the value (the top conversations dominate opens). **Trade-off:**
won't predict a cold-but-about-to-be-hot room; `onPressIn` covers that case with
free lead time anyway.

### 13.4 Presence on the room channel, last-seen for the list

**Decision:** live presence only inside open conversations (per-room channel);
the room list uses durable last-seen. **Why:** global presence for every contact
means N sockets/channels and a privacy fan-out; scoping to open conversations is
O(open rooms) sockets (usually 1) and matches the natural "we share a context
right now" privacy model. **Telegram comparison:** Telegram pushes account-wide
status to your contacts via one account connection; we don't have a contact
graph or a single multiplexed presence service, so per-conversation presence +
durable last-seen is the right fit for Supabase Realtime. **Trade-off:** the room
list's online dots are as fresh as the last sync, not live — acceptable, since
the *conversation* (where it matters) is live.

### 13.5 Source-side presence privacy

**Decision:** a user who hides presence simply doesn't `track`; peers never
receive an online for them. **Why:** never trust a client to hide another user's
status; enforce at the broadcaster and keep last-seen behind the RLS-gated RPC.
**Trade-off:** none meaningful — this is strictly safer than the poll model,
which already relied on `get_peer_profile` gating.

### 13.6 In-app idle, not OS background tasks

**Decision:** "background prefetch" is foreground-idle work, not
BGTaskScheduler/WorkManager. **Why:** OS background budgets are tiny and flaky,
add native config surface, and the highest-value warming (recent rooms, onPressIn)
is inherently foreground. **Telegram comparison:** Telegram does use OS background
refresh; we defer that as a possible future phase — it's not needed for the
"instant on tap" goal. **Trade-off:** no pre-warm while fully backgrounded; the
first foreground `poke` covers it.

### 13.7 Thumbnail-first, Wi-Fi-gated media

**Decision:** always warm the in-row micro-thumbnail (free); full images only for
the top warm set on Wi-Fi. **Why:** near-zero cellular cost with a real perceived
speedup (blur-up), matching Telegram's progressive loading. **Trade-off:** on
cellular the full image still loads on scroll (today's behavior) — deliberate.

### 13.8 Two independent flags

**Decision:** `FEATURE_INTELLIGENT_PREFETCH` and `FEATURE_PUSH_PRESENCE` are
separate. **Why:** they are unrelated risk surfaces (one touches caching/network
scheduling, the other touches Realtime presence); shipping/rolling-back
independently is safer. **Trade-off:** two flags to manage — worth it.

### 13.9 Transition-only presence writes

**Decision:** write `user_presence` on state transitions, not on a timer. **Why:**
~10× fewer writes and the online signal is now push, so the timer's only job
(freshness) is obsolete. **Trade-off:** if a device is force-killed without a
clean leave, its last-seen is the last transition write, which may lag by the
away interval — acceptable and still better than a 45s-granular timer.

---

## 14. Architectural Invariants

1. **Flag-off is byte-identical.** With both flags `false`, no scheduler runs, no
   presence channel extension is added, and the existing hooks/paths execute
   unchanged. This is the rollback contract.
2. **Prefetch is never load-bearing.** No correctness path may depend on a
   prefetch having run; cancelling/failing any task only falls back to the
   on-demand path.
3. **No new query surface.** Prefetch calls only existing services; presence uses
   only the existing channel + `get_peer_profile` + `user_presence`. No new RPC,
   no migration.
4. **No access widening.** Prefetch can only warm what the on-demand path could
   already fetch under RLS; it never reads rooms/users the user can't see.
5. **User work preempts speculative work.** InteractionManager gating + tiering +
   scope cancellation guarantee the active room/media/sync always win.
6. **Bounded everywhere.** Concurrency caps, 1-page look-ahead, per-batch image
   caps, RAM warm ≤1 room, LRU-capped local stats — nothing prefetch touches can
   grow unbounded.
7. **One coalescing authority.** Duplicate suppression lives in `syncService`
   (network) and the scheduler queue (intent); prefetch adds no second sync path.
8. **Presence privacy at the source.** Hidden users don't broadcast; last-seen
   stays RLS-gated. No client hides another's status.
9. **No render-path blocking.** Neither subsystem is ever `await`ed during render;
   all work is fire-and-forget off the commit path.

---

## 15. Rollout Strategy

1. **Land inert.** Ship `prefetchService`, `presenceService`, `presenceStore`,
   `roomOpenStats`, triggers, and constants with both flags `false`. Triggers are
   no-ops; hooks are unchanged. Verify byte-identical behavior (typecheck + manual
   smoke: opens, sends, search, presence dot all as today).
2. **Enable prefetch internally.** Flip `FEATURE_INTELLIGENT_PREFETCH` on a dev
   build; validate with the diagnostics layer (`diag` counters):
   `prefetch.scheduled`, `prefetch.deduped`, `prefetch.cancelled`,
   `prefetch.hit` (open found warm cache), `sync.coalesced` (prefetch riding a
   real pull). Watch that `sync.inflight` and network volume stay bounded.
3. **Enable push presence internally.** Flip `FEATURE_PUSH_PRESENCE`; verify
   join/leave latency, away transitions, multi-device collapse, reconnect
   re-track, and that hidden users never appear online. Confirm `user_presence`
   write rate drops sharply.
4. **Stage rollout / kill switch.** Each flag flips independently; regressions
   roll back by flipping to `false` with zero data cleanup (both subsystems own
   only disposable state).

---

## 16. Implementation Checklist (for the later build phase)

> Ordered so each step is independently verifiable and the flag stays shippable-off throughout.

1. **Constants** — add `FEATURE_INTELLIGENT_PREFETCH=false`, `FEATURE_PUSH_PRESENCE=false`,
   `PREFETCH_ROOM_WARM_COUNT`, `PREFETCH_MAX_CONCURRENT`, `PREFETCH_MEDIA_MAX_CONCURRENT`,
   `PREFETCH_IDLE_DELAY_MS`, `PREFETCH_LOW_BATTERY_PCT`, `PRESENCE_AWAY_MS`,
   `PRESENCE_DEVICE_ID` bootstrap, plus a presence schema/version note. (Mirror the
   existing flag comment style.)
2. **`prefetchService`** — module singleton: priority queue, dedup by key,
   `AbortSignal` cancellation, `schedule/cancel/cancelScope/poke/pause/resume`,
   `InteractionManager` + idle gating, concurrency lanes. Flag-off ⇒ every method
   a guarded no-op.
3. **`roomOpenStats`** — persisted Zustand store (AsyncStorage, LRU-capped),
   incremented in `useMessages` mount; warm-set selector blending recency +
   frequency + bookmarked.
4. **Triggers** — wire `onPressIn` (room row), app-launch batch (root layout),
   notification target (`notificationService`), room-list warm-set diff, active-room
   pre-paging + near-viewport image warm (via Phase 9 viewability signals), search
   focus around-window warm. All behind the flag.
5. **Media warm** — generalize `prefetchAlbumImages` into a scheduler-driven
   media task (thumbnail-first, Wi-Fi gate, avatar/emoji tiers).
6. **Network/battery gates** — integrate NetInfo + `expo-battery`; drive
   `pause/resume`; add `poke` to the existing `deltaResync` alongside outbox/media.
7. **`presenceStore`** — Zustand read model: `Record<userId, PresenceStatus>`,
   derivation (online/away/last-seen), multi-device collapse.
8. **`presenceService`** — presence extension on `room:${roomId}` channel:
   `track` on `SUBSCRIBED` (visibility-gated), leave/last-seen on teardown, sync
   handlers → `presenceStore`, the §7 state machine, transition-only
   `user_presence` writes, reconnect re-track.
9. **Hook swap** — behind `FEATURE_PUSH_PRESENCE`: `usePeerPresence`/header read
   from `presenceStore`; retire the 30s poll and 45s heartbeat interval on that
   path (keep both intact for flag-off).
10. **Diagnostics** — add the `prefetch.*` and `presence.*` `diag` taps (guarded
    no-ops under `FEATURE_RELIABILITY_DIAGNOSTICS`, §15 step 2/3).
11. **Verify** — `npx tsc --noEmit`; manual matrix: both flags off (identical),
    prefetch-only, presence-only, both on; offline/cellular/low-battery paths;
    multi-device presence; hidden-presence privacy.

---

*End of Phase 10 design. No code, migrations, or PRs are part of this deliverable.
The document is intended to be complete enough that implementation requires no
further architectural decisions.*

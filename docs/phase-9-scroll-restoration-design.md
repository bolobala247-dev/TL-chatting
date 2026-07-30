# Phase 9 — Scroll Restoration Architecture (Design)

> **Status:** DESIGN ONLY. No code ships in this phase. Every component below is
> additive and flag-gated (`FEATURE_SCROLL_RESTORE`, default `false`); with the
> flag off, the chat list behaves byte-for-byte like today — it always mounts at
> the bottom (newest message), exactly as `maintainVisibleContentPosition`
> `startRenderingFromBottom: true` renders now. Rollback is flipping the flag
> back to `false`.

Talo already renders chat from a bounded RAM cache backed by SQLite, with
FlashList v2 virtualization and `maintainVisibleContentPosition` keeping the
viewport stable when history loads above the fold. What it does **not** do is
remember *where you were reading*. Every time you re-open a room the list snaps
to the newest message (page 1 refetch → bottom). Telegram, by contrast, drops
you back at the exact message you last looked at, shows an unobtrusive
"N new messages" pill when there is unread content below, and lets you jump
around (search → message → back) without losing your place.

This phase designs **Telegram-style scroll restoration** as a thin, additive
layer on top of the existing rendering pipeline. It introduces exactly one new
piece of durable state (a per-room scroll anchor), one new coordination unit (a
non-reactive Scroll Manager living inside the chat screen), and one new UI
affordance (the new-messages pill). It changes **no** service, sync, repository,
or store data-flow contract.

---

## Requirement → section map

| Brief item | Section |
|---|---|
| 1. Scroll anchor model | §1 |
| 2. Recording strategy | §2 |
| 3. Restore strategy | §3 |
| 4. FlashList integration | §4 |
| 5. New messages pill | §5 |
| 6. Scroll state machine | §6 |
| 7. Interaction with incremental sync | §7 |
| 8. Interaction with search | §8 |
| 9. Performance | §9 |
| 10. Failure recovery | §10 |
| 11. Architecture diagram | §11 |
| 12. Design decisions & Telegram comparison | §12 |
| Architectural invariants | §13 |
| Rollout strategy | §14 |
| Implementation checklist | §15 |

---

## 0. Problem statement & scope

### What we have today (verified against the repository)

- **`MessageList`** (`src/components/chat/MessageList.tsx`): a `memo`'d FlashList
  v2 surface. The store keeps messages **newest-first**; the component reverses
  them into chronological order (`[...messages].reverse()`) and renders bottom-up
  via `maintainVisibleContentPosition.startRenderingFromBottom: true`. There is
  **no FlashList ref today** — no `scrollToIndex`, no `scrollToOffset`, no
  `onScroll`, no `onViewableItemsChanged`, no `initialScrollIndex`. Older history
  loads through `onStartReached` (threshold `0.2`) → `onLoadMore`.
- **`useMessages`** (`src/hooks/useMessages.ts`): on mount calls
  `setActiveRoom(roomId)`, `syncService.syncNow({ room })`, `clearUnread(roomId)`,
  `updateLastRead`; on unmount calls `setActiveRoom(null)` and `updateLastRead`.
  `loadMore` reads `useChatStore.getState()`, takes the oldest cached row's
  `created_at` as the cursor, and calls `fetchMessages(roomId, cursor)`.
- **`chatStore`** (`src/stores/chatStore.ts`): `messages` is
  `Record<roomId, MessageWithMeta[]>`, newest-first. `setActiveRoom` trims the
  **left** room to `ROOM_CACHE_TRIM_SIZE` (50), evicts LRU rooms beyond
  `MAX_CACHED_ROOMS` (8), and sets `hasMore[left]=true` when it trims. A room
  mount always refetches page 1 (`fetchMessages` without a cursor **replaces**
  the array), so trimmed/evicted history never survives a re-open.
- **`draftStore`** (`src/stores/draftStore.ts`): the canonical pattern for
  **device-local, per-room, never-synced** state — Zustand `persist` +
  `createJSONStorage(() => AsyncStorage)`, keyed by room id, entries deleted when
  empty. "Device-local drafts: survive restarts, work fully offline, never
  synced." The anchor store mirrors this exactly.
- **`roomStore`** (`src/stores/roomStore.ts`): owns `unread_count` per room
  (`incrementUnread`, `clearUnread`). The pill's unread interaction reads from
  here — it never invents its own counter.
- **Constants** (`src/lib/constants.ts`): `MESSAGES_PER_PAGE=20`,
  `MESSAGE_WINDOW_SIZE=200`, `ROOM_CACHE_TRIM_SIZE=50`, `MAX_CACHED_ROOMS=8`,
  `MAX_PERSISTED_PER_ROOM=1000`. These bound everything the restorer can rely on.
- **`app/search.tsx`**: `openRoom` does `router.push('/chat/${roomId}')` — it
  navigates to the room but does **not** scroll to the matched message. There is
  no jump-to-message anywhere in the app today.

### What we are adding

1. A **scroll anchor** per room: the message the user was last reading, plus a
   fractional offset within it, a timestamp, and enough metadata to decide
   whether restoring is still safe.
2. A **Scroll Manager**: a non-reactive controller (a `useRef`-held object +
   a small hook) that owns the FlashList ref, translates scroll events into
   anchor updates and scroll-state transitions, and performs restore/jump.
3. A **new-messages pill**: a Telegram-style floating affordance that appears
   when the user is reading history and content exists below the viewport.
4. A **jump history stack** so search (and future jump-to-reply) can return the
   user to exactly where they were.

### Explicit non-goals

- No changes to message delivery, sync, outbox, media, or search ranking.
- No new SQLite table or migration. The anchor is small device-local state and
  lives in AsyncStorage via a persisted Zustand store (see §1.4 for why).
- No server round-trips. Anchors are per-device and never synced (a different
  device legitimately has a different reading position).
- No cross-room "restore the whole app" scrollback beyond the resident cache.

---

## 1. Scroll Anchor Model

### 1.1 Shape

One anchor per room. The anchor identifies a **message** (not a pixel offset,
which is meaningless across relayout) plus a fractional position **within** that
message so a tall bubble (album, long text) restores to the same line, not just
its top edge.

```
ScrollAnchor {
  roomId:      string   // key
  messageId:   string   // the anchor message (stable server id, never a temp- id)
  offsetRatio: number   // 0..1 — vertical position of the viewport top *within*
                        //        the anchor item (0 = item top aligned to
                        //        viewport top; 1 = item bottom)
  createdAt:   string    // the anchor message's created_at (ISO) — the ordering
                        //        key; lets restore locate the message by time
                        //        even after ids churn, and lets us compare
                        //        "is there newer content than the anchor?"
  updatedAt:   number    // Date.now() when the anchor was last written — used
                        //        for eligibility (staleness) and LRU pruning
  atBottom:    boolean   // true if the user was pinned to the newest message;
                        //        when true, restore = normal bottom render and
                        //        the anchor is effectively "no restore needed"
}
```

### 1.2 Field rationale

- **`messageId` over pixel offset.** FlashList recycles and re-measures; a raw
  `contentOffset.y` is invalidated by any relayout above the fold (image load,
  older-history prepend, font metrics). A message id is stable and resolvable to
  an index inside the current window. This is the single most important decision
  in the model — everything else supports it.
- **`offsetRatio` (0..1), not absolute pixels.** A ratio survives relayout of the
  anchor item itself (e.g., an image that finishes decoding and grows). We store
  *where inside the item* the viewport top sat, as a fraction of the item's
  measured height at record time. On restore we convert back to pixels using the
  item's *current* measured height. Sub-pixel drift is invisible; the anchor
  message stays under the same finger.
- **`createdAt` as a time coordinate.** Ids can be replaced (optimistic temp- id →
  server id) and rows can be pruned. `created_at` is the room's monotonic
  ordering key (already relied on by `fetchMessages` sort and `loadMore` cursor).
  Storing it lets restore fall back to "nearest message at-or-before this
  timestamp" when the exact id is gone (§3.5, §10).
- **`atBottom`.** The overwhelmingly common case is "I was at the newest
  message." Encoding it as a boolean lets restore short-circuit to the existing
  bottom render with zero scroll math, and lets recording skip writing an anchor
  body at all (§2.6).
- **`updatedAt`.** Drives **restore eligibility** and bounded pruning.

### 1.3 Restore eligibility

An anchor is **eligible** to drive a restore when *all* hold:

1. `FEATURE_SCROLL_RESTORE` is on.
2. `atBottom === false` (a bottom anchor means "no restore" — see §3.1).
3. `Date.now() - updatedAt <= ANCHOR_TTL_MS` (default 7 days). Older anchors are
   psychologically stale — Telegram also forgets very old positions; a week is a
   generous ceiling and bounds AsyncStorage growth.
4. The anchor message is **locatable**: either present in the resident window, or
   resolvable from the SQLite cache on hydration, or (fallback) a
   nearest-by-`createdAt` neighbor exists (§3.5).

If any fails, restore degrades gracefully to **bottom** (the current behavior) —
never an error, never a blank screen (§10).

### 1.4 Where anchors live, and why

**Anchors live in a dedicated persisted Zustand store —
`useScrollAnchorStore` — backed by AsyncStorage, mirroring `draftStore`
exactly.** Rationale:

| Option | Verdict |
|---|---|
| **AsyncStorage via `persist` (chosen)** | Device-local, survives process restart, works fully offline, never synced, trivially bounded by row count. Same proven pattern as `draftStore`. Reads are synchronous from the rehydrated in-memory map (no I/O on the hot restore path). |
| SQLite (`meta` table or a new table) | Rejected. Would need a migration (explicit non-goal), makes reads async on the restore hot path, and couples a *UI ergonomics* concern to the *message truth* cache — violating the "anchor is not a source of truth" invariant. |
| RAM only (module map) | Rejected. Loses the position on process restart — the single most important Telegram behavior ("kill the app, re-open, land where you were"). |
| Server-synced | Rejected. Reading position is inherently per-device; syncing it would fight across a phone + tablet and add network coupling for zero benefit. |

The store shape:

```
useScrollAnchorStore (persist, name: "talo-scroll-anchors", AsyncStorage)
  anchors: Record<roomId, ScrollAnchor>
  setAnchor(anchor)          // upsert; no-op-equal guard to avoid rewrites
  clearAnchor(roomId)        // delete entry (e.g., user tapped to bottom)
  pruneAnchors()             // drop entries beyond ANCHOR_MAX_ROOMS by updatedAt,
                             // and any older than ANCHOR_TTL_MS (called on boot)
```

The anchor is **derived, disposable UI state** — like a draft. Losing it costs
nothing but a scroll-to-bottom. It is *never* consulted by any service, sync
path, or repository, and it is wiped with everything else on logout (AsyncStorage
clear already runs at logout).

---

## 2. Recording Strategy

The guiding constraint: **avoid excessive writes.** Scroll fires dozens of
events per second; AsyncStorage is not free. Recording therefore separates a
cheap, high-frequency **RAM candidate** from a rare, throttled **durable flush**.

### 2.1 Two-tier recording

- **Tier 1 — RAM candidate (every relevant scroll frame).** The Scroll Manager
  keeps the *current* anchor candidate in a `useRef` (non-reactive — no render).
  It is computed from FlashList's `onScroll` + viewable-items info: the topmost
  fully-or-partially visible message and its `offsetRatio`. This costs one object
  write per event; nothing renders.
- **Tier 2 — Durable flush (throttled + on lifecycle edges).** The RAM candidate
  is written to `useScrollAnchorStore` (→ AsyncStorage) only:
  - on a **trailing throttle** while scrolling (default `ANCHOR_FLUSH_MS = 500`),
    so a continuous scroll produces ~2 writes/sec, not 60;
  - on **scroll-idle** (momentum end / drag end) — one authoritative write of the
    resting position;
  - on **lifecycle edges** (§2.3–§2.5) — always a final flush.

### 2.2 Scroll throttling

`onScroll` uses `scrollEventThrottle={16}` for smooth candidate tracking but the
*durable* write is decoupled behind the 500 ms trailing throttle + idle flush.
The `offsetRatio`/topmost-item computation is O(visible items) (~10), pure
arithmetic, no allocation beyond one small object reused in place. See §9.

### 2.3 App background

On `AppState` change to `background`/`inactive`, the manager **force-flushes** the
RAM candidate immediately (bypassing the throttle). This is the critical path for
"kill the app and re-open": iOS/Android can terminate a backgrounded app without
further JS, so the flush must happen at the background transition, not later. The
listener is registered once per mounted chat screen and removed on unmount.

### 2.4 Room switch & 2.5 Leaving room

Both funnel through the chat screen's unmount (`useMessages` already runs cleanup
on unmount). The manager's cleanup effect **force-flushes** the final anchor
before `setActiveRoom(null)` runs. Because the store trims the *left* room's
window afterward (§0), the flush must precede trimming — but that is naturally
ordered: the manager's cleanup (child effect) runs before the screen tears down.
The anchor references a `messageId`, so even if the window is later trimmed the
anchor remains valid (it is re-resolved from SQLite on the next open, §3).

Room switch (tab → different room) is just unmount-then-mount of `[roomId]`, so
it is covered by the same edge. No special "switch" code path is needed.

### 2.6 Returning to bottom

When the user scrolls back to the newest message (viewport reaches the bottom —
FlashList's `onEndReached`/near-bottom threshold, reusing the existing
`autoscrollToBottomThreshold` semantics), the manager writes an anchor with
`atBottom: true` **and drops the offset body** (or simply calls
`clearAnchor(roomId)` — a missing anchor *is* "bottom", §3.1). This is the one
write we actively want, because it flips off restore for the next open and stops
the pill from showing. It is a single, debounced write.

### 2.7 What never triggers a write

- Programmatic scrolls performed *by* the restorer or a jump (§3, §8) — the
  manager sets an internal `suppressRecording` flag around them so a restore
  never records itself.
- Layout-driven viewport shifts from `maintainVisibleContentPosition` (older
  history prepend, keyboard) — these preserve the anchor by construction, so
  re-recording the same message is redundant and suppressed by the no-op-equal
  guard in `setAnchor`.

---

## 3. Restore Strategy

Restore runs once, when the chat screen mounts and its first data window is
ready. The Scroll Manager reads the eligible anchor (§1.3) and picks a path based
on **cache warmth** — how much of the room is already resident.

### 3.1 The bottom short-circuit (no anchor / atBottom)

If there is no eligible anchor, or `atBottom === true`, restore is a **no-op**:
the list renders at the bottom exactly as today (`startRenderingFromBottom`).
This is the common case and costs nothing — it is the flag-off behavior.

### 3.2 Warm room (anchor message resident)

The room is already in `chatStore.messages` (re-opened from cache, or never
evicted) **and** the anchor `messageId` is in the resident window. This is the
fast path:

1. Compute the target index in `orderedMessages` (chronological) from the id.
2. Before first paint, pass `initialScrollIndex = targetIndex` to FlashList so it
   renders *starting at* the anchor — no visible scroll, no jump (§4.2).
3. After mount, apply the `offsetRatio` fine-adjust via `scrollToOffset` relative
   to the item's measured layout (§4.4). Suppress recording during this.

### 3.3 Cached room (anchor in SQLite but not resident)

On first open in a session, `fetchMessages` (no cursor) replaces the array with
network page 1 (newest 20). The anchor message may be **older** than page 1 —
present in SQLite (`MAX_PERSISTED_PER_ROOM = 1000`) but not in the resident
window. Path:

1. Hydrate-first already paints the newest cached window (§0). The manager checks
   whether the anchor id is in that window.
2. If **not** present, the manager asks the cache for the message's position and
   loads the window *around* the anchor. Two sub-options, in priority order:
   - **Preferred:** a new **read-only** `cacheService.getRoomMessagesAround(roomId,
     anchorCreatedAt, radius)` that returns a chronological window centered on the
     anchor (radius ≈ `MESSAGES_PER_PAGE`). This is a pure SELECT over the
     existing `messages` table (no schema change), fed into `setRoomMessages`
     (the existing dumb setter). The window replaces the resident array; the list
     renders with `initialScrollIndex` at the anchor.
   - **Fallback (no new cache method):** page in older history via the existing
     `loadMore` cursor loop until the anchor enters the window or `hasMore` is
     exhausted, then restore. Bounded by a max-page guard so a very deep anchor
     degrades to "as far back as N pages, then bottom" rather than looping.
3. Newer messages between the anchor and bottom remain below the fold → the pill
   (§5) reflects them.

### 3.4 Cold room (nothing resident, offline, or anchor beyond cache)

If the room has no resident window and the network is unavailable, hydrate-first
still paints whatever SQLite holds. If the anchor is within that, restore as §3.3.
If the anchor is **beyond** persisted history (pruned past
`MAX_PERSISTED_PER_ROOM`), the anchor message is unresolvable → degrade to the
nearest-neighbor rule (§3.5) or, failing that, **bottom** (§3.1). Never block on
the network for a restore.

### 3.5 Anchor message no longer exists

If the exact `messageId` is gone (deleted, pruned, or never cached), restore uses
`createdAt` to find the **nearest surviving message at-or-before** the anchor
timestamp in the current window (binary search over the chronological array,
which is already time-sorted). Restore to that neighbor with `offsetRatio`
reset to `0` (top of the neighbor). If no neighbor exists (empty/too-shallow
window), degrade to bottom. The user lands "about where they were," which matches
Telegram's behavior when a pinned message is deleted.

### 3.6 Process restart

Identical to cached/cold (§3.3/§3.4): the persisted anchor rehydrates from
AsyncStorage synchronously into the store on boot, so it is available the instant
the chat screen mounts. `boot → open room → land at anchor` is the headline
Telegram behavior and is fully covered by the cached-room path.

---

## 4. FlashList Integration

The hard requirement: **no layout jumps.** The restorer must never produce a
visible "snap to bottom, then jerk up to the anchor" flash. Every technique below
is chosen to render *already at the right place*, not to scroll there after paint.

### 4.1 `maintainVisibleContentPosition` (unchanged)

We keep the existing config verbatim:

```
maintainVisibleContentPosition={{
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: 0.2,
  animateAutoScrollToBottom: false,
}}
```

This is what keeps the viewport stable when older history prepends (§7.2) and
what auto-scrolls to a *new* message only when the user is already near the
bottom. Restoration is *layered on top* of MVCP, not a replacement for it. When
restoring to a non-bottom anchor, `startRenderingFromBottom` is overridden by
`initialScrollIndex` for the first render (see §4.2); MVCP's
`autoscrollToBottomThreshold` continues to govern new-message auto-scroll
afterward.

### 4.2 `initialScrollIndex` — the no-jump primitive

FlashList v2 accepts `initialScrollIndex`, which renders the list *starting at*
that index on first commit — no post-paint scroll, therefore **no jump**. When an
eligible non-bottom anchor resolves to a resident index, the manager passes it as
`initialScrollIndex`. This is the primary mechanism; it is why §3 works so hard to
get the anchor message *into the window* before first paint. Combined with
FlashList v2's automatic sizing, the first frame is already at the anchor.

Because `initialScrollIndex` is a first-render-only prop, the manager computes it
synchronously from the (rehydrated) anchor + the initial data window, memoized so
it is stable for the list's lifetime of that room. Changing rooms remounts the
list (key = `roomId`), so a fresh `initialScrollIndex` is computed per room.

### 4.3 `estimatedItemSize`

FlashList **v2 no longer requires `estimatedItemSize`** — it measures
automatically and the prop is a deprecated no-op. We deliberately do **not**
reintroduce it. Accurate first-frame positioning for `initialScrollIndex` comes
from v2's own measurement, not from a guessed constant. (This is called out
explicitly because a naive scroll-restore implementation is tempted to add
`estimatedItemSize` to "help" `scrollToOffset` math — that path is rejected; see
§12.)

### 4.4 `scrollToIndex` and `scrollToOffset`

The manager holds a FlashList `ref` (new — none exists today). Usage:

- **`scrollToIndex({ index, animated, viewPosition })`** — used for **jumps**
  (search result, §8) where an *animated* motion to a message the user explicitly
  requested is desirable and expected. `viewPosition: 0.5` centers the target.
- **`scrollToOffset({ offset, animated: false })`** — used for the **`offsetRatio`
  fine-adjust** after an `initialScrollIndex` restore (§3.2 step 3), applied in a
  post-layout callback. Non-animated so it is imperceptible.

Restoration itself never uses *animated* `scrollToIndex` (that would be the very
jump we forbid). Jumps do, because the motion is the point.

### 4.5 Virtualization interaction

FlashList only mounts a viewport-sized window of items. Two consequences the
design must respect:

1. **The anchor index must exist in `data` before `initialScrollIndex` is
   honored.** This is exactly why §3.3 loads the window *around* the anchor first.
   `initialScrollIndex` pointing past the end of `data` would clamp to the end
   (bottom) — an acceptable degrade, but we avoid it by ensuring the window
   contains the anchor.
2. **Recycling must not confuse the anchor.** `keyExtractor = item.id` and
   `getItemType = item.type` (both already present) guarantee the anchor is
   identified by stable id, never by a recycled cell. No change needed.

### 4.6 No-jump guarantee — summary

The no-jump guarantee rests on three pillars, in order:
1. Get the anchor message **into the data window before first paint** (§3).
2. Render **starting at** it via `initialScrollIndex` (§4.2), not by scrolling
   after paint.
3. Apply only a **non-animated sub-item `offsetRatio` nudge** afterward (§4.4),
   inside a `suppressRecording` guard.
If any pillar cannot be satisfied (anchor not locatable), the list falls back to
bottom render — which is also jump-free because it is the default first render.

---

## 5. New Messages Pill

A Telegram-style floating affordance anchored bottom-right above the composer.

### 5.1 Label & content

- When the room has unread messages below the fold: **"N tin nhắn mới"** (N new
  messages), where N is `roomStore.unread_count` for the room (never a
  pill-owned counter). All strings Vietnamese, via `chat` i18n namespace.
- When the user is simply reading history with **no** unread below (they scrolled
  up in an already-read room): a plain **down-chevron** button with no count —
  "scroll to bottom." Same component, count omitted.

### 5.2 Visibility rules

The pill is visible when **both**:
1. The scroll state (§6) is `readingHistory`, `restored`, or `jumped` — i.e., the
   viewport is **not** pinned to the bottom (distance-from-bottom exceeds a
   threshold, reusing `autoscrollToBottomThreshold` semantics); **and**
2. There is content below the current viewport (always true when not at bottom).

The unread count is an *annotation* on the pill, not a visibility condition: the
pill shows whenever you are away from the bottom, and *displays* the count only
when `unread_count > 0`.

### 5.3 Dismiss rules

- **Reaching the bottom** (scroll or via tap) hides the pill and, if unread,
  triggers the existing `clearUnread(roomId)` path — the pill never manages
  unread state itself.
- The pill is **not** manually dismissible (no close button) — Telegram's pill
  isn't either; it disappears by getting to the bottom. This avoids a "dismissed
  but still not at bottom" ambiguous state.

### 5.4 Tap behavior

- **No unread:** `scrollToOffset` to the very bottom, `animated: true`. State →
  `atBottom`. Clears the anchor (§2.6).
- **With unread:** two-stage, matching Telegram:
  - If the first unread message is within the resident window, `scrollToIndex` to
    the **first unread** (the read/unread boundary), `animated: true`,
    `viewPosition: 0` — so the user starts reading at the first thing they missed,
    not blindly at the newest.
  - Then reaching the bottom clears unread as in §5.3.
  - If the first unread is not resident (large backlog), scroll straight to bottom
    and clear unread (the backlog is bounded by the window; this is the pragmatic
    degrade).

### 5.5 Animation

`react-native-reanimated` v4 (already a dependency): the pill fades + slides up
(`opacity` 0→1, `translateY` 8→0) on show, reverse on hide, ~150 ms, `easeOut`.
The count text uses a subtle scale-pop when it increments. Animations run on the
UI thread — no JS re-render per frame (§9).

### 5.6 Unread interaction

The pill reads `unread_count` reactively from `roomStore` with a **selector**
(`useRoomStore((s) => s.rooms.find(...)?.unread_count)`) so only the pill
re-renders when the count changes — never the message list. New realtime messages
that arrive while reading history increment `unread_count` (existing path) and the
pill's count updates in place with the scale-pop; the list does **not** auto-scroll
(the user is reading history — see §7.1).

---

## 6. Scroll State Machine

A single, explicit state drives the pill, the auto-scroll decision, and recording.
It lives in the Scroll Manager as a `useRef` (non-reactive); a derived boolean
(`showPill`) is the only piece mirrored into React state, and only when it flips.

### 6.1 States

| State | Meaning |
|---|---|
| `atBottom` | Pinned to newest. New messages auto-scroll. No pill. Anchor cleared / `atBottom:true`. |
| `readingHistory` | User scrolled up. New messages do **not** auto-scroll; they bump the pill count. Anchor recorded. |
| `restored` | Just mounted at a restored anchor (§3). Behaves like `readingHistory` but marks that the position came from restore (for diagnostics + first-frame suppression). |
| `jumped` | Arrived via search/jump (§8). Like `readingHistory` but a "return" affordance / back-stack entry is active. |
| `loadingOlder` | `onStartReached` fetch in flight (older history). MVCP holds position. |
| `loadingNewer` | Fetching newer window (only in the around-anchor / jump paths). |
| `paginating` | Transient umbrella used by diagnostics for either load direction. |

### 6.2 Transitions

```
            mount, eligible anchor
   (start) ─────────────────────────▶ restored
            mount, no/at-bottom anchor
   (start) ─────────────────────────▶ atBottom

   atBottom ──scroll up past threshold──▶ readingHistory
   readingHistory ──reach bottom / tap pill──▶ atBottom  (clearUnread, clearAnchor)
   restored ──scroll (any)──▶ readingHistory
   restored ──reach bottom──▶ atBottom
   jumped ──reach bottom──▶ atBottom
   jumped ──tap "return"──▶ (restore previous stack entry) → restored/readingHistory

   readingHistory ──onStartReached──▶ loadingOlder ──done──▶ readingHistory
   {restored|jumped} ──need newer window──▶ loadingNewer ──done──▶ same state
```

### 6.3 Why a machine

Auto-scroll-on-new-message, pill visibility, and "should I record an anchor" are
three questions with one answer: *are we at the bottom or not?* Centralizing that
in one enum removes the scattered boolean soup that scroll-restore bugs usually
come from, and makes each interaction (§7, §8) a well-defined transition rather
than an ad-hoc effect.

---

## 7. Interaction with Incremental Sync

Restoration must stay stable while the Phase 4 sync engine and realtime mutate the
window underneath it. The rule in every case: **anchor by id, let MVCP hold
pixels, never auto-scroll unless `atBottom`.**

### 7.1 New realtime messages arrive

- **State `atBottom`:** existing behavior — `addMessage` prepends (store is
  newest-first), MVCP auto-scrolls to show it (within `autoscrollToBottomThreshold`).
  No pill.
- **State `readingHistory`/`restored`/`jumped`:** `addMessage` prepends but MVCP
  does **not** auto-scroll (we're away from bottom). The new row lands below the
  fold; `roomStore.unread_count` increments (existing path) → pill count updates
  (§5.6). The anchor is untouched (a different, older message). Reading position is
  pixel-stable because MVCP anchors on the currently-visible content, not the
  newly-inserted bottom row.

### 7.2 Older history loads

`onStartReached` → `loadMore` prepends older rows (appends to the newest-first
array tail → chronological *top*). MVCP's whole purpose is to keep the visible
content fixed while content is inserted above; the anchor message does not move
relative to the viewport. State → `loadingOlder` → back. No anchor rewrite (§2.7).

### 7.3 Message edited

`updateMessage` patches in place (same id, same position). If the **anchor**
message is edited and its height changes, the `offsetRatio` is recomputed lazily
on the next scroll frame; no active correction is needed because the user is
looking at it and MVCP keeps its top stable. No jump.

### 7.4 Message deleted

`removeMessage` filters the row out. If the deleted row is the **anchor**, the
anchor becomes "message gone" — handled *lazily*: nothing happens on screen now
(MVCP absorbs the removed row's height for content above the fold), and the *next*
restore uses the nearest-neighbor rule (§3.5). We do **not** eagerly rewrite the
anchor on delete (avoids a write; the anchor is only consulted at restore time).

### 7.5 Media finishes loading

Image/album bubbles grow when they decode (`applyAttachmentsPatch`, expo-image).
This is the classic scroll-jump trigger. Two protections:
1. MVCP keeps content **above** the anchor stable, so a taller image *below* the
   viewport never shifts what you're reading.
2. For an image *inside* the anchor item, `offsetRatio` (a fraction, not pixels)
   means the restored position tracks the growing item proportionally. The image
   prefetch already warms the newest window (`prefetchAlbumImages`), reducing
   mid-scroll decode pops.

### 7.6 Around-anchor window swap (§3.3)

When restore replaces the resident array with an around-anchor window via
`setRoomMessages`, that is a single atomic store write *before* first paint of the
restored position, so no jump is observable. A subsequent background
`syncService.syncNow` delta merges into the same window through the existing
repository merge; because it is id-keyed and time-sorted, the anchor index is
recomputed from the id if the array identity changes (memo dependency on
`orderedMessages`), keeping the pill/position correct.

---

## 8. Interaction with Search

Today `openRoom` just `router.push('/chat/${roomId}')` — no scroll to the matched
message. Phase 9 upgrades this to a **jump**, with a return stack.

### 8.1 Search result → jump to message

1. Search passes the target `messageId` + `created_at` to the chat route (e.g.
   `router.push('/chat/${roomId}?focus=${messageId}&at=${createdAt}')`).
2. On mount, the Scroll Manager sees a `focus` param and treats it as a **jump
   target** (higher priority than the saved anchor): it ensures the target is in
   the window (around-anchor load, §3.3, keyed on the focus message) and
   `scrollToIndex` to it with `animated: true`, `viewPosition: 0.5`, then briefly
   highlights the bubble (existing highlight/pulse styling, ~1.2 s). State →
   `jumped`.
3. Before jumping, the manager **pushes the pre-jump position** (the current
   eligible anchor, or "bottom") onto the jump stack (§8.3).

### 8.2 Restore previous position / jump back

While in `jumped` state a lightweight **"return" chip** (up-arrow, Telegram's
"back to where I was") is shown. Tapping it pops the jump stack and restores the
previous position (§3 machinery reused). Reaching the bottom naturally also clears
the `jumped` affordance.

### 8.3 Multiple jumps & history stack

The manager keeps a bounded **jump stack** (`JUMP_STACK_MAX = 10`) in a `useRef`
(RAM only, per chat-screen lifetime — not persisted; a jump trail is a within-session
concept). Each jump pushes the from-position; each "return" pops one. Search →
msg A → tap a quoted reply → msg B → return → A → return → original. This mirrors
Telegram's jump-back behavior (its down-arrow chevron with a stacked count).
The stack is cleared when the user reaches bottom or leaves the room. It is **not**
the same as the durable anchor: the anchor is "where I was reading last time I left";
the jump stack is "the trail of jumps within this visit."

### 8.4 Persistence boundary

The jump stack is deliberately **not** persisted (RAM only). The durable anchor
(§1) is the only thing that survives restart. Rationale: a jump trail across an
app restart is confusing and unbounded; Telegram also loses the jump trail on
restart while keeping the reading position.

---

## 9. Performance

The overriding rule: **the message list must not re-render for scroll or for the
pill.** Restoration is invisible to FlashList's render path.

### 9.1 Memory impact

- One `ScrollAnchor` per room in AsyncStorage + the rehydrated in-memory map,
  bounded by `ANCHOR_MAX_ROOMS` (default 50 → a few KB). Pruned on boot (§1.4).
- The jump stack is ≤10 tiny objects, RAM only.
- The around-anchor window (§3.3) reuses the existing bounded window
  (`MESSAGE_WINDOW_SIZE`) — no additional resident rows beyond what a normal open
  holds. No new caches, no retained closures over message arrays.

### 9.2 CPU impact

- Candidate computation per scroll frame is O(visible ≈ 10) arithmetic, no
  allocation beyond one reused object. Durable writes are throttled to ~2/sec
  (§2.1).
- `initialScrollIndex` restore does zero post-paint scrolling in the common warm
  path; the `offsetRatio` nudge is a single `scrollToOffset`.
- Binary search for nearest-neighbor (§3.5) is O(log n) over an already-sorted
  array, run at most once per restore.

### 9.3 Scroll listeners

Exactly **one** `onScroll` handler on the FlashList (`scrollEventThrottle=16`),
plus FlashList's own `onViewableItemsChanged` (viewability config tuned to report
the topmost visible item). Both are stable `useCallback`s created once. No
per-item scroll listeners. The `AppState` listener is one subscription per mounted
screen.

### 9.4 Re-render avoidance & memoization

- `MessageList` stays `memo`'d; the FlashList `ref`, `initialScrollIndex`, and the
  scroll callbacks are all **stable for the room's lifetime**, so adding them does
  **not** break the existing "skip re-render on composer keystroke" optimization.
- The Scroll Manager holds state/candidate/stack in `useRef` — mutating them never
  triggers a render. Only `showPill` (a boolean) is React state, and it flips at
  most on bottom-crossing, not per frame.
- The pill subscribes to `unread_count` via a **narrow selector**; it re-renders
  independently of the list.
- The `orderedMessages` reverse memo is unchanged; `initialScrollIndex` is
  computed from it with a memo so the reverse cost is not duplicated.

### 9.5 No extra rendering — audit

| Event | Renders `MessageList`? |
|---|---|
| Scroll frame | No (ref only) |
| Durable anchor flush | No (AsyncStorage write, no store subscribed by list) |
| Pill show/hide | No (separate component) |
| Pill count change | No (selector on pill only) |
| New message while reading history | Only the normal `addMessage` list update (unchanged) |
| Restore on mount | One first paint (already happening); no second scroll render |

---

## 10. Failure Recovery

Every failure degrades to **bottom render** — the flag-off behavior — never an
error or blank screen. The anchor is disposable by design (§1.4).

| Failure | Detection | Recovery |
|---|---|---|
| **Missing anchor** (never recorded) | No entry for `roomId` | Bottom render (§3.1). Normal for a first-ever open. |
| **Deleted anchor message** | Id absent from window after load | Nearest-neighbor by `createdAt` (§3.5); else bottom. |
| **Cache eviction** (room evicted from RAM) | No resident window | Hydrate-first + around-anchor load from SQLite (§3.3); else bottom. |
| **Database pruning** (anchor older than `MAX_PERSISTED_PER_ROOM`) | Not in SQLite either | Bottom render; anchor left as-is (may become valid again is impossible, so it is pruned on next `pruneAnchors`). |
| **Offline** | Network fetch fails | SQLite-only restore; never blocks on network (§3.4). |
| **Corrupt / malformed anchor** | `offsetRatio` NaN / out of range, missing fields | Treat as ineligible → bottom; `clearAnchor`. |
| **Version upgrade** (anchor schema change) | `ANCHOR_SCHEMA_VERSION` mismatch in persisted blob | `persist` `version` + `migrate`: on mismatch, drop all anchors (they are disposable) and start fresh at bottom. |
| **AsyncStorage read/write error** | try/catch around persist | Log via existing diagnostics; treat as no-anchor. Never throw into render. |

The `persist` middleware gets an explicit `version: N` and a `migrate` that
**discards** on any unknown version — anchors are never worth migrating.

---

## 11. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  app/chat/[roomId].tsx  (Screen)                                           │
│  • composes useMessages + <MessageList> + <NewMessagesPill>                │
│  • reads ?focus= param (search jump)                                       │
│                                                                            │
│    ┌────────────────────────────────────────────────────────────────┐    │
│    │  useScrollManager(roomId, ref)   ← NEW, non-reactive controller  │    │
│    │  • owns FlashList ref, scroll state machine (§6), jump stack     │    │
│    │  • candidate anchor (useRef) ← onScroll/onViewableItemsChanged   │    │
│    │  • throttled/edge flush → AnchorStore                            │    │
│    │  • computes initialScrollIndex; runs restore/jump (§3, §8)       │    │
│    └───────────┬───────────────────────────────┬────────────────────┘    │
│                │ ref + initialScrollIndex        │ showPill / count        │
│                ▼                                 ▼                          │
│   ┌───────────────────────────┐      ┌───────────────────────────┐        │
│   │  MessageList (memo)        │      │  NewMessagesPill (§5)      │        │
│   │  • FlashList v2 + MVCP     │      │  • reanimated, selector    │        │
│   │  • onScroll / viewable     │      │    on roomStore.unread     │        │
│   └───────────┬───────────────┘      └───────────────────────────┘        │
└───────────────┼────────────────────────────────────────────────────────── ┘
                │ data (orderedMessages)                    ▲
                ▼                                           │ unread_count
   ┌─────────────────────────┐   ┌──────────────────────────────────────┐
   │  chatStore (messages)   │   │  roomStore (unread_count)             │
   │  newest-first, bounded  │   │  incrementUnread / clearUnread        │
   └───────────┬─────────────┘   └──────────────────────────────────────┘
               │ setRoomMessages / fetchMessages / addMessage
               ▼
   ┌─────────────────────────┐        ┌───────────────────────────────────┐
   │  cacheService           │◀──────▶│  Sync Engine (syncService, Ph.4)  │
   │  getRoomMessagesAround*  │        │  syncNow → repository merge        │
   │  (*new read-only SELECT) │        └───────────────────────────────────┘
   └───────────┬─────────────┘                     ▲
               ▼                                    │ realtime INSERT/UPDATE/DELETE
   ┌─────────────────────────┐        ┌───────────────────────────────────┐
   │  SQLite (messages, v-?)  │        │  Realtime (useRealtime)           │
   │  droppable cache         │        │  → addMessage/updateMessage/...   │
   └─────────────────────────┘        └───────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────┐
   │  useScrollAnchorStore  (persist → AsyncStorage, "talo-scroll-anchors") │
   │  Record<roomId, ScrollAnchor>   ← device-local, offline, never synced  │
   └──────────────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────┐
   │  app/search.tsx  → router.push('/chat/{id}?focus={msgId}&at={ts}')     │
   └──────────────────────────────────────────────────────────────────────┘
```

Data-flow note: the Scroll Manager reads/writes only the **Anchor Store** and the
FlashList **ref**; it reads message data from `chatStore` (via the screen) and
unread from `roomStore`. It never calls a service, sync, or repository directly —
the one new cache method (`getRoomMessagesAround`) is invoked through the existing
`cacheService`/`setRoomMessages` seam, preserving the one-way data flow.

---

## 12. Design Decisions & Telegram Comparison

| # | Decision | Why | Telegram parallel |
|---|---|---|---|
| D1 | **Anchor by message id + fractional offset**, not pixel offset | Pixels are invalidated by relayout (media, prepend); ids + ratio survive it | Telegram anchors on a message, restoring to the same message after restart |
| D2 | **Persist anchors in AsyncStorage (Zustand `persist`)**, not SQLite | No migration, sync reads on the hot path, keeps the anchor out of the message-truth cache | Telegram stores reading position in local app state per chat |
| D3 | **`initialScrollIndex` as the primary restore primitive**, not post-paint `scrollToIndex` | Renders *at* the anchor on first commit → structurally impossible to see a jump | Telegram opens a chat already scrolled to the last-read message |
| D4 | **Two-tier recording (RAM candidate + throttled/edge flush)** | Scroll fires ~60/s; unthrottled persistence would thrash AsyncStorage and jank scroll | — (implementation detail) |
| D5 | **Force-flush on background** | OS can kill a backgrounded app with no further JS; the position must be durable at the transition | Telegram survives force-quit with position intact |
| D6 | **`atBottom` short-circuit / no anchor = bottom** | The common case costs nothing and equals today's behavior — safe default & clean flag-off | Telegram opens active chats at the bottom |
| D7 | **Pill count from `roomStore.unread_count`, not a pill-owned counter** | Single source of truth for unread; no drift between badge and pill | Telegram's pill shows the unread count and jumps to first unread |
| D8 | **Jump stack in RAM, anchor durable** | A jump trail across restart is confusing/unbounded; reading position is not | Telegram keeps position across restart, loses the jump trail |
| D9 | **Nearest-neighbor fallback by `created_at`** | A deleted/pruned anchor should land "about where you were," not at bottom | Telegram lands near a deleted pinned/target message |
| D10 | **Do NOT reintroduce `estimatedItemSize`** | FlashList v2 measures automatically; a guessed constant would fight v2's own sizing and can *cause* jumps | — (v2 semantics) |
| D11 | **New read-only `getRoomMessagesAround` over paging loop** | One bounded SELECT beats N sequential `loadMore` round-trips to reach a deep anchor; falls back to the loop if not implemented | Telegram loads a window centered on the target message |
| D12 | **Non-reactive Scroll Manager (`useRef`)** | Scroll/state/stack must never trigger list re-renders; only `showPill` is React state | — (RN performance) |
| D13 | **Everything flag-gated & additive** | Matches the repo's Phase 4/5A/7/8 rollout discipline; instant rollback; zero cost when off | — |

### Where we intentionally diverge from Telegram

- **No persisted jump trail** (D8) — simpler and matches user mental model on
  mobile restart.
- **Pill is not manually dismissible** (§5.3) — removes an ambiguous "dismissed
  but not at bottom" state; you dismiss by getting to the bottom.
- **Reading-position TTL of 7 days** (§1.3) — Telegram is vaguer here; we bound
  storage and treat very old positions as stale.

---

## 13. Architectural invariants

These must hold in every subsequent implementation phase. Each maps to a
diagnostics assertion (Phase 6B `consistencyAuditor` style, kind `scroll-drift`)
so a violation is observable, not silent.

| # | Invariant |
|---|---|
| I-R1 | **The anchor is never a source of truth.** No service, sync path, or repository reads it. Messages remain the sole source of truth; the anchor is disposable UI state. |
| I-R2 | **Flag-off is byte-identical to today.** With `FEATURE_SCROLL_RESTORE=false`, no anchor is read/written, no pill renders, no FlashList prop changes — the list mounts at the bottom exactly as now. |
| I-R3 | **No layout jumps.** Restore never produces a visible scroll after first paint (warm path); the only post-paint motion is a non-animated sub-item `offsetRatio` nudge, or an *explicitly requested* animated jump. |
| I-R4 | **The message list never re-renders for scroll or pill.** Scroll state, candidate, and jump stack are non-reactive; the pill is a separate selector-driven component. |
| I-R5 | **Any restore failure degrades to bottom**, never to an error or blank screen. |
| I-R6 | **Recording is bounded.** Durable writes are throttled + edge-triggered; anchors are pruned by count and TTL. |
| I-R7 | **The one-way data flow is preserved.** The Scroll Manager touches only the Anchor Store and the FlashList ref directly; message data changes flow through the existing store/cacheService seam. |
| I-R8 | **`maintainVisibleContentPosition` behavior is unchanged** for existing paths (older-history prepend, new-message auto-scroll near bottom). |

---

## 14. Rollout strategy

1. **Flag default `false`.** Ship the store, manager, pill, and cache method
   dormant. Flag-off path proven identical to today (I-R2).
2. **Internal dogfood with flag on.** Verify warm/cached/cold/restart paths, pill,
   search jump, and the no-jump guarantee on both iOS and Android (keyboard open,
   media-heavy rooms, long backlogs).
3. **Diagnostics on** (`FEATURE_RELIABILITY_DIAGNOSTICS`): watch `scroll-drift`
   assertions and restore-latency/flush-frequency gauges.
4. **Gradual enable**, then default `true`. Rollback at any point is flipping the
   flag back to `false` — anchors on disk are simply never read while off, and are
   pruned by TTL.

The feature is independent of `FEATURE_DELTA_SYNC`, `FEATURE_OFFLINE_OUTBOX`,
`FEATURE_MEDIA_PIPELINE`, and `FEATURE_LOCAL_SEARCH`: toggling scroll restoration
can never change delivery, sync, media, or search behavior.

---

## 15. Implementation checklist (for the build phase)

Design is decision-complete; the build phase should need no further architecture.

- [ ] Add `FEATURE_SCROLL_RESTORE`, `ANCHOR_TTL_MS`, `ANCHOR_MAX_ROOMS`,
  `ANCHOR_FLUSH_MS`, `ANCHOR_SCHEMA_VERSION`, `JUMP_STACK_MAX` to
  `src/lib/constants.ts`.
- [ ] `src/stores/scrollAnchorStore.ts` — persisted Zustand store mirroring
  `draftStore` (name `"talo-scroll-anchors"`, `version`, `migrate`-discards,
  `setAnchor` no-op-equal guard, `clearAnchor`, `pruneAnchors`).
- [ ] `src/hooks/useScrollManager.ts` — non-reactive controller: FlashList ref,
  scroll state machine (§6), candidate tracking, throttled/edge/background flush,
  `initialScrollIndex` computation, restore (§3), jump (§8), suppress-recording
  guard.
- [ ] `MessageList` — accept a forwarded `ref`, `initialScrollIndex`, `onScroll`,
  viewability config; keep `memo` and stable-prop guarantees (I-R4). No
  `estimatedItemSize` (D10).
- [ ] `src/components/chat/NewMessagesPill.tsx` — reanimated, `roomStore` selector,
  tap behavior (§5.4), Vietnamese strings in `locales/*/chat.json`.
- [ ] `cacheService.getRoomMessagesAround` — read-only SELECT window centered on a
  `created_at`; feed via `setRoomMessages`. (Optional; paging-loop fallback exists.)
- [ ] `app/search.tsx` — pass `?focus=&at=` on result tap; `app/chat/[roomId].tsx`
  — read the params and hand them to the manager as a jump target; add the pill and
  the "return" chip.
- [ ] Diagnostics — `scroll-drift` auditor kind + restore-latency/flush-frequency
  gauges (Phase 6B style), gated by `FEATURE_RELIABILITY_DIAGNOSTICS`.
- [ ] Verify all invariants I-R1..I-R8; confirm flag-off byte-identical behavior.
```

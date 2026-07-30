# Phase 11 — Scroll-to-Message Architecture (Design)

> **Status:** DESIGN ONLY. No code ships in this phase. Every component below is
> additive and flag-gated (`FEATURE_SCROLL_TO_MESSAGE`, default `false`); with the
> flag off, tapping a search result behaves exactly like Phase 9 does today (the
> one-shot `?focus=&at=` open), reply previews stay non-interactive, no highlight
> renders, and no new store is read or written. Rollback is flipping the flag back
> to `false`.

Talo can already **open a room focused on one message**: Phase 9's
`useScrollManager` reads `?focus=&at=` launch params, and — once per mount — either
scrolls to a resident target or swaps in a cached *around-window*
(`cacheService.getRoomMessagesAround`) and scrolls to it with
`scrollToIndex({ viewPosition: 0.5 })`, guarding the programmatic move with a
`suppressRef`. What it does **not** do is: jump **repeatedly** within an open room,
jump from a **reply bubble / pinned banner / mention / notification**, **highlight**
the landed message, remember a **jump trail** so you can return, resolve a target
that is **not in the cache at all** (older than the local window, or brand-new), or
**serialize** overlapping jumps.

This phase designs **Telegram-style Scroll-to-Message** as a thin, additive layer
that **generalizes the Phase 9 proto-jump into one reusable pipeline** shared by
every jump source. It introduces one non-reactive coordinator (a **Jump Scheduler**
folded into the Scroll Manager), one RAM-only store (jump history + highlight
token), one dispatch **bus** (so a deeply-nested bubble can request a jump without
prop-drilling), and one highlight animation. It changes **no** service, sync,
repository, or store data-flow contract, and adds **no** migration.

---

## Requirement → section map

| Brief item | Section |
|---|---|
| 1. Philosophy | §1 |
| 2. Jump sources | §2 |
| 3. Jump pipeline | §3 |
| 4. Message resolution | §4 |
| 5. Around-window loading | §5 |
| 6. FlashList integration | §6 |
| 7. Highlight animation | §7 |
| 8. Jump history | §8 |
| 9. Interaction with scroll restoration | §9 |
| 10. Interaction with search | §10 |
| 11. Interaction with reply | §11 |
| 12. Interaction with incremental sync | §12 |
| 13. Jump scheduler | §13 |
| 14. Failure recovery | §14 |
| 15. Performance | §15 |
| 16. Architecture diagram | §16 |
| 17. Design decisions & Telegram comparison | §17 |
| Architectural invariants | §18 |
| Rollout strategy | §19 |
| Implementation checklist | §20 |
| New constants / files summary | §21 |

---

## 0. Problem statement & scope

### What we have today (verified against the repository)

- **`useScrollManager`** (`src/hooks/useScrollManager.ts`) already owns the
  FlashList ref, exposes `ScrollFocusTarget { messageId, createdAt }`, and has a
  once-per-mount **search jump** effect (`jumpedRef` latches it):
  - if the target is resident → `setPill(true)` + `scrollToRenderedId(id, true)`
    which calls `listRef.scrollToIndex({ index, animated, viewPosition: 0.5 })`;
  - else → `cacheService.getRoomMessagesAround(roomId, focus.createdAt, MESSAGES_PER_PAGE)`
    → `useChatStore.setRoomMessages(roomId, windowRows)` → `scrollToRenderedId`.
  - The programmatic move is wrapped in `suppressRef` so it does not record a
    false anchor (§9). An empty around-result leaves the room at the bottom.
- **`toRenderedIndex(total, newestFirstIndex)`** and
  **`nearestNewestFirstIndex(messages, targetIso)`** already exist in the manager:
  the store is **newest-first**, the list renders **reversed** (chronological,
  `startRenderingFromBottom: true`), and the nearest-neighbor-by-time fallback is
  already implemented for restore.
- **`cacheService.getRoomMessagesAround(roomId, around, radius)`** →
  `repos.messages.getWindowAround` runs two bounded SELECTs (`created_at <= around`
  DESC LIMIT radius; `created_at > around` ASC LIMIT radius), merged newest-first,
  de-duped by id. This is the around-window primitive; it is **read-only** and
  never throws (`[]` when the cache is unavailable).
- **`chatStore`** keeps `messages: Record<roomId, MessageWithMeta[]>` newest-first,
  bounded: active room ≤ `MESSAGE_WINDOW_SIZE` (200), left room trimmed to
  `ROOM_CACHE_TRIM_SIZE` (50) with `hasMore=true`. `setRoomMessages` swaps the
  array wholesale (used by the sync merge and the Phase 9 jump). A room mount
  refetches page 1 (`fetchMessages` w/o cursor **replaces** the array).
- **Jump sources today:** only **search** (`app/search.tsx` →
  `router.push('/chat/{id}?focus={msgId}&at={ts}')`). **Reply** previews render via
  `ReplyContext` inside `MessageBubble` but are a plain `View` — **not tappable**.
  **`PinnedBanner`** `onPress` opens the pinned *sheet* (no jump). **Notifications**
  (`useNotifications`) navigate to `/chat/{roomId}` with **no** focus param.
  **Mentions / unread marker** have no jump affordance.
- **Server fetch surface:** `messageService.getMessages(roomId, cursor?)` returns
  `MESSAGES_PER_PAGE` rows with `created_at < cursor` (older-than paging only).
  There is **no** server "around" or "by-id" fetch today.
- **Constants already reserved:** `JUMP_STACK_MAX = 10`,
  `SCROLL_BOTTOM_THRESHOLD_PX = 120`, `MESSAGES_PER_PAGE = 20`,
  `MESSAGE_WINDOW_SIZE = 200`, `ROOM_CACHE_TRIM_SIZE = 50`.
- **Prefetch (Phase 10):** `prefetchService.warmSearchAround(roomId, at)` already
  pre-warms the around-window when deep-link params resolve (chat screen §5 wiring).

### Scope

**In scope:** a single Jump pipeline reused by all sources; repeatable in-room
jumps; a Jump Scheduler (serialize/cancel/dedup); a resolution ladder
(resident → SQLite window → server around-fetch → nearest-neighbor fallback); the
around-window loader (reusing the Phase 9 primitive, plus one optional new server
method); FlashList jump mechanics; a one-shot highlight; a RAM jump-history stack
with a "return" chip; tappable reply previews, pinned-item jumps, mention jumps,
and focus-carrying notifications.

**Out of scope / non-goals:** no migration; no change to send/sync/search/media
contracts; no persisted jump trail (RAM only, like Phase 9's stated intent); no
new realtime channel; no server RPC beyond one optional read-only around-select.

---

## 1. Scroll-to-Message Philosophy

**Why it exists.** A chat is a timeline you *navigate*, not just a feed you scroll.
Users constantly need to leave "now" and inspect a *specific* past moment — the
message a reply quotes, a pinned announcement, a search hit, the message a push
notification is about — and then get back. Manual scrolling to a message from three
months ago is impossible when only a 200-row window is resident and the rest lives
in SQLite or on the server.

**Why it differs from normal scrolling.** Normal scrolling is *continuous,
user-driven, O(pixels)* motion within already-rendered data; the Phase 9 Scroll
Manager only *observes* it (records anchors, toggles the pill). A jump is
*discrete, system-driven, and may require loading data that isn't resident*. It is a
**transaction**: resolve a target → guarantee it's in the window → move the
viewport → confirm arrival → highlight → leave a way back. It must be cancellable,
must not fight `maintainVisibleContentPosition`, and must not record a false reading
position.

**User expectations (Telegram-calibrated).**
- Tapping a reply/pinned/search/mention takes me **directly** to that message,
  centered, with a brief **highlight** so I can see *which* one.
- If the message is far away, I see it resolve **quickly** (a short spinner at
  worst), not a scroll animation through thousands of rows.
- A **back affordance** returns me to exactly where I was (Telegram's down-arrow
  badge / "return to previous position").
- Chained jumps (reply → its reply → its reply) each remember the step before.
- If the target is **gone** (deleted/unreachable), I get a gentle "message not
  available" rather than a broken scroll or a blank screen.

**UX principles.**
1. **Direct, not scenic** — reposition the *window* around the target and snap; do
   not animate through intervening messages (O(window), not O(conversation)).
2. **Always land somewhere sane** — every failure degrades to nearest-neighbor,
   else the bottom; never an error screen (mirrors Phase 9 I-R5).
3. **Highlight, don't shout** — one gentle pulse (~1.5s), auto-dismiss; never a
   looping animation.
4. **Reversible** — a jump is undoable via the return chip; the reading position
   the user *chose* (their Phase 9 anchor) is never silently overwritten by a jump.
5. **One jump at a time** — overlapping requests are serialized/superseded, never
   interleaved (§13).

---

## 2. Jump Sources

Every source funnels through **one** entry point:

```
jumpController.requestJump({
  roomId, messageId, createdAt?, source, highlight?: boolean
})
```

`createdAt` is the ordering key used for around-loading and nearest-neighbor
fallback; when a source only knows the id (e.g. a reply's `reply_to`), the
controller resolves `createdAt` during the Resolve stage (§3/§4). The controller
decides **in-room** vs **cross-room** dispatch (§3.0). All sources therefore reuse
the identical pipeline, scheduler, resolution ladder, highlight, and history.

| Source | Trigger (today → Phase 11) | Knows | Notes |
|---|---|---|---|
| **Search result** | `app/search.tsx` tap → `?focus=&at=` (exists) | id + createdAt | Becomes a `requestJump` that, cross-room, still uses the `?focus=&at=` deep link (§10). |
| **Reply bubble** | `ReplyContext` View (not tappable) → **wrap in `Pressable`** | `reply_to` id (+ createdAt if the quoted row is resident) | Same-room jump; resolves createdAt if unknown (§11). |
| **Pinned message** | `PinnedBanner` opens sheet; **sheet row tap** → jump; **banner tap** may jump to latest pin | id + createdAt (pinned rows carry both) | Reuses pipeline; sheet closes then jumps (§2.1). |
| **Mention** | New: tapping an `@you` chip / a "jump to mention" affordance | id + createdAt | Same as reply; mention list is future, the pipeline is ready. |
| **Notification** | `useNotifications` → `/chat/{roomId}` (no focus) → **add `?focus=&at=`** when the push payload carries `messageId`/`createdAt` | id + createdAt (from `notification.data`) | Cross-room cold-start path; reuses the deep-link seam (§2.2). |
| **Unread marker** | New: "N tin nhắn mới" pill / unread divider → jump to first-unread | createdAt of `last_read_at` boundary | Jump target is the *first unread*, resolved by time (§2.3). |
| **External deep link (future)** | `talo://chat/{roomId}?focus=&at=` | id + createdAt | Same params contract as search/notification; no new work when it lands. |

### 2.1 Pinned

`PinnedBanner` keeps its current behavior (tap → open `PinnedMessagesSheet`); the
**new** behavior is per-row: tapping a pinned message in the sheet calls
`requestJump({ source: "pinned", messageId, createdAt })`, closes the sheet, and the
scheduler runs the jump against the now-frontmost chat screen. (Optional nicety: a
single-pin banner tap jumps straight to that pin.)

### 2.2 Notification

Cold start (app killed) and warm tap both flow through `useNotifications`. When the
push `data` includes `messageId` + `createdAt`, navigation becomes
`/chat/{roomId}?focus={messageId}&at={createdAt}` — the **exact** Phase 9 param
contract, so the mounting Scroll Manager runs the jump on first paint. When the
payload lacks a message id, behavior is unchanged (open at bottom). `warmRoom` /
`warmSearchAround` (Phase 10) already pre-warm the target.

### 2.3 Unread marker

The Phase 9 pill jumps to **bottom**; the Phase 11 unread affordance jumps to the
**first unread message**, resolved by the peer/self `last_read_at` boundary
(nearest message with `created_at > last_read_at`). It is a normal `requestJump`
with `source: "unread"`; if the boundary message isn't resident it around-loads
like any other target.

---

## 3. Jump Pipeline

One lifecycle, driven by the Jump Scheduler (§13). Stages:

```
Source → requestJump
  │
  ├─(3.0) Route: in-room vs cross-room
  │
  ▼
Resolve target (§3.1, §4)      ── id (+createdAt?) → concrete resolution class
  ▼
Locate message (§3.2)          ── is it resident in the chatStore window?
  ▼
Prepare window (§3.3)          ── decide: none | around-load(cache) | around-fetch(server)
  ▼
Load if necessary (§3.4)       ── swap window via setRoomMessages (bounded)
  ▼
Scroll (§3.5)                  ── scrollToIndex(viewPosition:0.5), suppress-guarded
  ▼
Highlight (§3.6)               ── one-shot pulse via jumpStore token
  ▼
Restore interaction (§3.7)     ── push history entry, show return chip, re-arm recording
```

### 3.0 Route — in-room vs cross-room

- **Cross-room** (`target.roomId !== activeRoomId`): the controller navigates via
  `router.push('/chat/{roomId}?focus={id}&at={createdAt}')` (Phase 9 seam). The
  destination screen's Scroll Manager consumes the params and runs the pipeline on
  mount. If `createdAt` is unknown, the source must resolve it before navigating
  (search/pinned/notification always have it; reply/mention within another room is
  not a current affordance). **Return** across rooms uses the nav stack (`router.back`)
  augmented by the in-room history chip once landed.
- **In-room** (`target.roomId === activeRoomId`): dispatched to the mounted
  controller through the **jump bus** (§13.1) — no navigation, no remount.

### 3.1 Resolve target

Classify the target (§4) using the resident window + cache metadata:
resident / SQLite-only / needs-server / deleted / temp. If `createdAt` is missing,
resolve it: (a) from the resident row if present; (b) from a cheap cache lookup by
id; (c) from a server by-id read as a last resort. A `temp-` id is rejected
immediately (§4, §11).

### 3.2 Locate message

Search the resident `chatStore.messages[roomId]` for the exact id. Hit → skip
Prepare/Load, go straight to Scroll. Miss → Prepare.

### 3.3 Prepare window

Decide the minimal data operation:
- **around-load (cache):** `cacheService.getRoomMessagesAround(roomId, createdAt,
  JUMP_WINDOW_RADIUS)`. If it returns a window that contains the id → use it.
- **around-fetch (server):** if the cache window does **not** contain the id (older
  than the local cache, or a brand-new message not yet synced), call the new
  read-only `messageService.getMessagesAround(roomId, createdAt, JUMP_WINDOW_RADIUS)`
  (§5.1), write it through `cacheService.saveMessages`, and use it.
- **none:** target resident (from 3.2) or a nearest-neighbor fallback chosen (§4).

### 3.4 Load if necessary

Swap the resident window with `useChatStore.getState().setRoomMessages(roomId,
windowRows)` — the **same** seam Phase 9 and the sync merge use. The array stays
bounded (§5.4). This is guarded by `suppressRef` so the swap + subsequent scroll do
not record a false anchor (§9). Loading is **cancellable** (§13): a superseding
jump or room-leave abandons the in-flight fetch and never calls `setRoomMessages`.

### 3.5 Scroll

`requestAnimationFrame(() => scrollToRenderedId(messageId, animated))` where
`scrollToRenderedId` maps newest-first index → rendered index (`toRenderedIndex`)
and calls `listRef.scrollToIndex({ index, animated, viewPosition: 0.5 })` (center).
Rules:
- **Animated** only for *short* in-window moves where the target was already
  resident (nice continuity). After a **window swap** the move is **non-animated**
  (an animated scroll across a freshly-replaced dataset reads as a flash) — matches
  Phase 9's `requestAnimationFrame` + immediate index approach.
- `.catch()` swallows a transient out-of-range (index briefly invalid during the
  data swap) exactly as the Phase 9 jump does.

### 3.6 Highlight

Publish `{ messageId, token }` to `jumpStore.highlightByRoom[roomId]` (§7). The
target `MessageBubble` selects on it and runs a one-shot pulse. The token (a
monotonic counter) lets the *same* message be re-highlighted on a repeat jump.

### 3.7 Restore interaction

Push a **history entry** (the position we jumped *from*) so the return chip can undo
(§8), show the **return chip**, re-arm anchor recording (clear `suppressRef` after a
short settle, mirroring Phase 9's 400–500ms window), and clear the scheduler slot.

---

## 4. Message Resolution

The **resolution ladder** — cheapest first, each rung falling through to the next:

| Class | Condition | Action |
|---|---|---|
| **Resident** | id in `chatStore.messages[roomId]` | Scroll directly (no load). |
| **SQLite-only** | not resident, but `getRoomMessagesAround` returns a window containing the id | Swap window (cache) → scroll. |
| **Requires pagination** | cached but beyond the around-radius on one side | The around-window *is* the bounded pagination — one `getWindowAround` centered on the target replaces N sequential `loadMore` calls (D-J4). |
| **Requires sync / server** | not in cache (older than local history, or brand-new not yet merged) | `getMessagesAround` (server) → `saveMessages` (write-through) → swap → scroll. Requires network. |
| **Deleted** | resolved row has `deleted_at` (tombstone) | Jump to the tombstone if resident/loadable; highlight + it renders "Tin nhắn đã được thu hồi". If no tombstone row exists → nearest-neighbor. |
| **Edited** | same id, newer `content`/`updated_at` | Transparent — resolve by id; the window already carries the latest content. No special case. |
| **Temporary** | id starts with `temp-` | **Rejected** — never a jump target (unsent/optimistic). Reply-to-pending is disabled at the source (§11). |
| **Server message** | any real id + createdAt | The general case handled by the ladder above. |

**Fallback strategy (graceful, never fatal).** If the exact id cannot be located or
loaded (offline cache-miss, server timeout, deleted with no tombstone):
1. **Nearest-neighbor by time** — reuse `nearestNewestFirstIndex(messages,
   createdAt)`; land on the closest message and show a subtle "không tìm thấy tin
   nhắn — đã cuộn tới vị trí gần nhất" note (no highlight, or a muted one).
2. If even that is impossible (empty room / no `createdAt`) → **land at bottom**
   (Phase 9 default) and surface a one-line toast "Không thể mở tin nhắn".
3. Never throw, never blank — this is invariant **I-J5** (§18).

---

## 5. Around-Window Loading

### 5.1 The window primitive

- **Cache:** `cacheService.getRoomMessagesAround(roomId, around, radius)` (exists)
  → `getWindowAround`: `radius` rows `created_at <= around` (DESC) + `radius` rows
  `> around` (ASC), merged newest-first, de-duped. So a full window is up to
  `2 × radius` rows centered on the target.
- **Server (new, optional):** `messageService.getMessagesAround(roomId, around,
  radius)` — the same shape against Supabase: two selects (`.lte("created_at",
  around).order(desc).limit(radius)` and `.gt("created_at", around).order(asc)
  .limit(radius)`) using the existing `MESSAGE_WITH_META_SELECT`, merged
  newest-first. Read-only; embeds ride along; **no** RPC / type regen (mirrors
  `getRoomMessagesSince`). Used **only** when the cache window misses the id.

### 5.2 Window size & centering

- `JUMP_WINDOW_RADIUS` = `MESSAGES_PER_PAGE` (20) each side ⇒ ~41 rows incl. target.
  Chosen to match the existing page size and keep the swap cheap; the target sits
  in the **middle** so scrolling either direction after landing has context and
  `onStartReached` / new-message paths keep working.
- Centering: `scrollToIndex({ viewPosition: 0.5 })` puts the target mid-viewport
  (same as Phase 9). For a target near the newest edge, `maintainVisibleContentPosition`
  + `startRenderingFromBottom` naturally keep the bottom pinned; `viewPosition` is
  best-effort and FlashList clamps it.

### 5.3 Older / newer continuation after landing

After a jump the resident window is the ~41-row around-window. Continuing to scroll:
- **Older (upward):** existing `onStartReached` → `onLoadMore` → `fetchMessages
  (roomId, oldestCreatedAt)` extends history exactly as today.
- **Newer (downward):** if the window's newest row is **not** the room's newest
  message, reaching the bottom of the window must load newer rows. Today
  `fetchMessages` only pages *older*. Design: the down-arrow / "jump to latest" pill
  (Phase 9 `NewMessagesPill`) is shown whenever the resident window is not
  bottom-anchored; tapping it re-hydrates page 1 (newest) via the normal
  `fetchMessages(roomId)` replace. (Seamless *downward* pagination is a deliberate
  non-goal — see D-J8; the pill is the escape hatch, matching Telegram's behavior of
  a down button after a jump.)

### 5.4 Window replacement & memory limits

- Replacement is a single `setRoomMessages` swap (bounded to the ~41-row window;
  well under `MESSAGE_WINDOW_SIZE=200`). The previously-resident newest window is
  dropped from RAM but remains in SQLite (droppable cache) and is re-hydrated on the
  next page-1 fetch or "jump to latest".
- Because the active room's window is replaced (not appended), memory stays O(window).
  Leaving the room trims to `ROOM_CACHE_TRIM_SIZE` as usual; re-opening refetches
  page 1, so a jumped-away window never persists as the room's "normal" state.

### 5.5 Interaction with cache & sync

- The around-load is **read-through**: cache first, server only on miss, always
  written back via `saveMessages` (which also advances sync cursors + indexes for
  search — the existing seam). So a server around-fetch **warms** the cache for
  next time and keeps search/sync consistent.
- The swapped window participates in incremental sync normally: `syncService.syncNow`
  merges deltas into whatever window is resident (§12).

---

## 6. FlashList Integration

- **`scrollToIndex`** is the primary primitive (already used):
  `viewPosition: 0.5` centers; `animated` per §3.5. The newest-first→rendered index
  map is `toRenderedIndex(total, nfi)`; `scrollToRenderedId(id)` finds the id then
  scrolls. `.catch()` handles a transient out-of-range during a swap.
- **`scrollToOffset`** is **not** used for jumps (offsets are invalidated by
  variable row heights + media relayout — the same reason Phase 9 anchors by id, D1).
  It remains available only for the existing bottom-snap path.
- **`initialScrollIndex`** stays the *cross-room / cold-open* mechanism (Phase 9):
  the destination screen computes it from `?focus=&at=` so the room renders **at**
  the target on first commit (no post-paint jump). In-room repeat jumps use
  `scrollToIndex` because the list is already mounted.
- **Virtualization / recycling:** unchanged. `getItemType` keeps per-type recycle
  pools; the jump only changes `data` (the window) and issues one `scrollToIndex`.
  No `estimatedItemSize` is introduced (FlashList v2 self-measures — Phase 9 D10).
- **Cell measurement / layout changes:** after a window swap, `requestAnimationFrame`
  defers the scroll one frame so FlashList has committed the new cells before we
  index into them (Phase 9 pattern). `maintainVisibleContentPosition` is left intact
  so media loading above the target doesn't shift it (I-J8).
- **Smooth-scroll guarantee:** we never animate across a freshly-swapped dataset
  (§3.5) and never scroll through the whole conversation — at most `2×radius` rows
  exist, so `scrollToIndex` is O(window).

---

## 7. Highlight Animation

Telegram-style: the landed bubble briefly washes with the brand tint, then fades.

- **Mechanism:** `jumpStore.highlightByRoom[roomId] = { messageId, token }`.
  `MessageBubble` selects `useJumpStore((s) => s.highlightByRoom[roomId]?.messageId
  === message.id ? s.highlightByRoom[roomId].token : null)`. A non-null token drives
  a `react-native-reanimated` sequence on a shared value. Only the **one** target
  bubble subscribes to a truthy value; all others select `null` and never animate
  (I-J4).
- **Shape:** `fade-in (≈120ms) → hold (≈900ms) → fade-out (≈500ms)` — total
  `JUMP_HIGHLIGHT_DURATION_MS ≈ 1500`. A background-color overlay (or animated
  `backgroundColor`) from `transparent → primary/10 → transparent`.
- **Pulse / repeat:** **single** pulse, **no** repeat (D-J6; avoids the "excessive
  animation" the brief warns against). A repeat *jump* to the same message bumps the
  `token`, which re-triggers exactly one pulse.
- **Color:** brand `primary` at low alpha (e.g. `primary/10`–`primary/15`), theme-aware
  via `useThemeColors`; must read as a gentle wash, not a selection state.
- **Interaction / dismiss:** the highlight is **passive** — it never blocks taps.
  It auto-clears when the sequence ends (the store entry is reset by the controller
  after `JUMP_HIGHLIGHT_DURATION_MS`), and is **superseded** immediately by any new
  jump (new token) or cleared on room-leave. User scrolling does **not** need to
  cancel it (it's brief), but a manual scroll may clear it early for crispness
  (optional).
- **Reduced motion:** if the OS "reduce motion" flag is set, collapse to a static
  hold-then-fade (no fade-in ramp) — accessibility parity.

---

## 8. Jump History

A **RAM-only** trail so the user can return after one or more jumps.

- **Model:** `jumpStore.historyByRoom: Record<roomId, JumpEntry[]>` where
  `JumpEntry = { anchor: { messageId, createdAt, offsetRatio } | "bottom",
  fromSource }`. The anchor captures *where the viewport was* the instant before the
  jump — reusing the Phase 9 `AnchorCandidate` the Scroll Manager already tracks.
- **push:** at Restore-interaction (§3.7), before moving, push the current position.
- **pop / return:** the **return chip** (a floating down-arrow, Telegram-style) pops
  the top entry and runs a jump **back** to it (bottom → `scrollToEnd`; a message →
  the same pipeline, usually resident so it's an instant `scrollToIndex`).
- **multiple / nested jumps:** each jump pushes; reply→reply→reply builds a stack;
  each return pops one level. The chip shows while the stack is non-empty.
- **history limit:** `JUMP_STACK_MAX` (10, already in constants) — oldest entries
  drop (bounded RAM). Exceeding it is a non-event (you just can't return past 10).
- **room switching:** the stack is **per-room**; leaving a room keeps its stack in
  RAM only while the room is cached (cleared on eviction / logout / `reset`). A
  cross-room jump does **not** share stacks — the return there is `router.back`.
- **process restart:** the stack is **not** persisted (D-J7); after a cold start
  there is no return trail, only the durable Phase 9 **anchor** (reading position).
  This matches the brief's "durable anchor vs temporary jump history" distinction.

**Durable anchor vs temporary jump history.** The Phase 9 anchor is *one* durable,
per-room reading position (survives restart, drives restore). The jump history is a
*transient* in-session stack of "places I bounced through". They never conflict: a
jump does **not** write the anchor (it's suppressed, §9); only genuine resting scroll
does.

---

## 9. Interaction with Scroll Restoration

Phase 11 sits directly on top of Phase 9 and must not corrupt reading position.

- **Restored position:** on room open with a saved anchor and **no** `?focus`, Phase
  9 restore runs unchanged. A jump is a *separate* intent that happens *after* (or
  via the focus param instead of) restore.
- **Jump ⇒ suppress recording:** the whole Prepare→Load→Scroll sequence runs under
  `suppressRef=true` (Phase 9 already does this for the search jump). So the
  window-swap and programmatic scroll never fire `onViewableItemsChanged`/`onScroll`
  into a durable `setAnchor`. The user's *chosen* reading position is preserved.
- **Return:** popping the jump history restores the pre-jump viewport; if the user
  then rests there, normal Phase 9 recording writes it as the new anchor.
- **Anchor updates — when NOT to change:** the anchor changes **only** when the user
  *manually* rests at a non-bottom position (Phase 9 flush) or reaches bottom
  (clear). A jump, a return, a highlight, and a window-swap **never** write the
  anchor (I-J1 + Phase 9 I-R1). Reaching bottom after a jump still clears the anchor
  + unread (the existing "caught up" rule) — that's a genuine user action.
- **History replacement:** the jump stack is orthogonal to the anchor store; they
  live in different stores (RAM `jumpStore` vs persisted `scrollAnchorStore`) and
  never write each other.

---

## 10. Interaction with Search

Search is the **reference** jump source and already drives the Phase 9 proto-jump;
Phase 11 generalizes it.

- **Single result:** `app/search.tsx` tap → `requestJump` → cross-room deep link
  `?focus=&at=` (unchanged wire format) → destination Scroll Manager jumps on mount.
  In-room (searching within the open room, a future in-chat search) dispatches via
  the bus with no navigation.
- **Multiple results / next / previous:** an in-chat search (future affordance) can
  hold an ordered result list and call `requestJump` for result *k*; **next**/**prev**
  are just `requestJump(results[k±1])`. Each reuses the scheduler (a new request
  supersedes the previous, §13) and the highlight. No new pipeline.
- **Return to search:** cross-room, `router.back()` returns to the search screen
  (nav stack). In-room, the jump-history return chip restores the pre-search-jump
  position. Search's own scroll state is the screen's concern, untouched here.
- **History interaction:** a search jump pushes a jump-history entry like any other,
  so after landing on a hit the return chip goes back to where you were reading.

---

## 11. Interaction with Reply

Making reply previews jumpable is the largest *new* wiring.

- **Tap reply:** wrap `ReplyContext` in a `Pressable` → `requestJump({ source:
  "reply", messageId: reply_to, createdAt: <resolved> })`. If the quoted row is
  resident, `createdAt` is read from it; otherwise the controller resolves it (§3.1)
  before around-loading.
- **Missing / not cached:** run the resolution ladder — around-load (cache) →
  around-fetch (server) → nearest-neighbor. Most replies are to recent messages
  (usually resident or in the newest cache window), so the common case is instant.
- **Deleted message:** if the quoted message was recalled, `ReplyContext` already
  renders "Tin nhắn đã được thu hồi"; the jump lands on the tombstone (if present)
  with a muted highlight, else nearest-neighbor + note (§4).
- **Older than cache:** server around-fetch; if offline → nearest-neighbor + "không
  có sẵn khi ngoại tuyến" note.
- **Offline:** cache-only ladder; no server fetch; graceful nearest-neighbor/bottom.
- **Temp / pending quote:** replying to a `temp-` message is disabled at the source
  (swipe-to-reply already excludes `temp-` ids, per `MessageBubble`), so a reply
  preview never points at an unsent message; the jump guard rejects `temp-` anyway.

---

## 12. Interaction with Incremental Sync

The jump must stay consistent while realtime/sync mutate the resident window.

- **Realtime insert:** `addMessage` prepends to the newest-first array (bounded). If
  the resident window is a **jumped-away** around-window (not bottom-anchored), a new
  insert still prepends to index 0 of the array but the user isn't at the bottom, so
  it does not yank the viewport (`maintainVisibleContentPosition` + not-at-bottom).
  The `NewMessagesPill` count increments (Phase 9). No conflict with an in-flight
  jump: the scheduler's target is an **id**, re-located after any array change.
- **Realtime delete:** if the jump target is deleted mid-flight, resolution finds
  the tombstone or falls to nearest-neighbor (§4). If a *non-target* row is deleted,
  the window just shrinks; `scrollToIndex` re-derives the index from the current
  array at scroll time.
- **Realtime edit:** same id, patched content (`updateMessage`); the jump resolves
  by id regardless of edits (§4 Edited).
- **Media loading:** images above the target could shift layout; `maintainVisible
  ContentPosition` holds the target, and highlight is keyed by id not offset, so the
  wash stays on the right bubble (I-J8).
- **Pagination:** older-history `onLoadMore` appends to the array end; since indices
  are re-derived at scroll time from the live array, a concurrent page-load never
  scrolls to a stale index.
- **Anchor movement / consistency:** the jump reads message data only through
  `chatStore` + `cacheService` (never a private copy), so it always sees the merged
  truth. **Consistency guarantee:** the scheduler resolves the target index **at the
  moment of scroll**, from the current resident array — never from a snapshot taken
  before a load/merge (I-J7).

---

## 13. Jump Scheduler

A single-slot, non-reactive coordinator that guarantees **one jump at a time**.

- **Location:** folded into `useScrollManager` (which already owns the ref,
  `suppressRef`, and the proto-jump), exposed as `requestJump(target, opts)`. State
  lives in refs (no re-render — I-J4), mirroring the manager's existing design.
- **Dispatch bus (`jumpBus`):** a module-level singleton the mounted manager
  registers its `requestJump` with (`register(roomId, handler)` on mount,
  `unregister` on unmount). Sources deep in the tree (a reply bubble, the pinned
  sheet) call `jumpBus.request(target)`; the bus forwards to the active room's
  handler, or navigates (cross-room) if the target room isn't mounted. This avoids
  prop-drilling a callback through `MessageList`→`MessageBubble`→`ReplyContext`.
- **priority:** user-initiated jumps (tap) are highest; a passive one (e.g. an
  auto "jump to first unread" on open) yields to any user tap. Practically: a newer
  request **supersedes** an older in-flight one.
- **cancellation:** an in-flight around-fetch carries an `AbortController` /
  generation counter; superseding it or leaving the room cancels the fetch and its
  pending `setRoomMessages`/scroll (the stale callback checks the generation and
  no-ops). Same guard Phase 9 uses via `disposed`/`suppressRef`.
- **deduplication:** a `requestJump` to the message already centered + highlighted is
  a no-op (re-bumps the highlight token only). Identical rapid taps collapse.
- **concurrency:** exactly **1** active jump (single slot). A second request replaces
  the slot; the first is abandoned at its next await boundary.
- **animation sequencing:** load → `requestAnimationFrame` → scroll → publish
  highlight token → (after `JUMP_HIGHLIGHT_DURATION_MS`) clear token → clear slot.
  The highlight of a superseded jump is cancelled by the new token.
- **prevent overlapping jumps:** the single slot + generation counter make
  overlapping scrolls structurally impossible; the list never receives two
  `scrollToIndex` calls racing to different targets.

---

## 14. Failure Recovery

Every failure degrades gracefully (I-J5); the matrix:

| Failure | Handling |
|---|---|
| **Target missing** (id not resolvable anywhere) | Nearest-neighbor by `createdAt`; if none → bottom. Muted note "không tìm thấy tin nhắn". |
| **Deleted message** | Tombstone jump if the row exists; else nearest-neighbor. Reply preview already shows "đã thu hồi". |
| **Cache miss** (not in SQLite) | Server around-fetch; on success warm cache + jump; on failure → offline/timeout paths below. |
| **Offline** | Cache-only ladder; no server fetch; nearest-neighbor/bottom + "không có sẵn khi ngoại tuyến". |
| **Sync / fetch timeout** | `JUMP_LOAD_TIMEOUT_MS` (e.g. 6s) bounds the around-fetch; on timeout → nearest-neighbor + toast; the slot clears (no hung spinner). |
| **Window load failure** (`getWindowAround`/`getMessagesAround` throws) | Services never throw for cache reads (`[]`); a server error is caught → fallback. |
| **Cancelled jump** (superseded / room-leave) | Generation check no-ops the stale callback; no scroll, no highlight, no history push. |
| **Index out of range** at scroll | `scrollToIndex().catch()` swallows it (transient during swap); a retry on the next frame or fallback to nearest-neighbor. |
| **Empty room / no createdAt** | Land at bottom (Phase 9 default); toast "Không thể mở tin nhắn". |

A brief inline spinner (or the return chip area) may show while an around-fetch is
in flight; it is bounded by `JUMP_LOAD_TIMEOUT_MS` and never blocks the UI thread.

---

## 15. Performance

**Guarantee: O(window), not O(conversation).** A jump touches at most `2×radius`
(~41) rows regardless of how far the target is.

- **CPU:** one array swap (`setRoomMessages`), one `scrollToIndex`, one reanimated
  pulse on one bubble. No list-wide re-render (data identity changes once; memoized
  bubbles with stable props skip). Index resolution is a single `findIndex` over ≤200
  rows.
- **Memory:** the resident window stays bounded (≤`MESSAGE_WINDOW_SIZE`); a jump
  *replaces* rather than grows it. Jump history is ≤`JUMP_STACK_MAX` tiny entries per
  room, RAM only. Highlight state is one `{id, token}` per room.
- **Disk IO:** at most two bounded indexed SELECTs (`getWindowAround`) per uncached
  jump; cached-resident jumps touch disk **zero** times.
- **Network:** zero for resident/SQLite jumps; one bounded around-fetch only on a
  true cache miss, written back so it never repeats. Phase 10 prefetch
  (`warmSearchAround`) often makes even deep jumps hit warm cache.
- **Avoid unnecessary rendering:** highlight is a per-target selector (I-J4); the
  return chip is a separate small component; scheduler state is non-reactive refs.
- **Avoid unnecessary loading:** resolution is cheapest-first; the around-window is
  the *minimum* superset containing the target; no full-conversation load ever.

---

## 16. Architecture Diagram

```
 SOURCES
 ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐
 │  Search  │ │  Reply   │ │  Pinned  │ │ Notification │ │ Mention/ │
 │(search.tsx)│(ReplyCtx)│ │ (Sheet)  │ │(useNotif.)   │ │ Unread   │
 └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘ └────┬─────┘
      │            │            │              │              │
      └────────────┴──────┬─────┴──────────────┴──────────────┘
                          ▼
                 ┌───────────────────────┐   cross-room  ┌────────────────────────┐
                 │  jumpBus.request()     │──────────────▶│ router.push(/chat/{id}  │
                 │  (module singleton)    │   (Phase 9)   │   ?focus=&at=)          │
                 └───────────┬───────────┘                └────────────────────────┘
                             │ in-room (registered handler)
                             ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  Jump Scheduler  (inside useScrollManager — non-reactive)     │
        │  single slot · generation/AbortController · dedup · sequence  │
        │  Resolve → Locate → Prepare → Load → Scroll → Highlight → Hist│
        └───┬───────────────┬───────────────┬───────────────┬──────────┘
            │ ref/scrollTo  │ setRoomMessages│ read window   │ token/history
            ▼               ▼                ▼               ▼
   ┌────────────────┐ ┌──────────────┐ ┌───────────────┐ ┌──────────────────────┐
   │  MessageList    │ │  chatStore    │ │ cacheService  │ │  jumpStore (RAM only) │
   │  FlashList v2   │ │ messages[room]│ │ getRoomMsgs   │ │ historyByRoom         │
   │  scrollToIndex  │ │ (newest-first)│ │  Around()     │ │ highlightByRoom{id,tok}│
   │  MVCP           │ └──────┬────────┘ └──────┬────────┘ └───────────┬──────────┘
   └───────┬────────┘        │                 │                       │ selector
           │ highlight token │ setRoomMessages │ read/miss             ▼
           ▼                 ▼                 ▼             ┌──────────────────────┐
   ┌────────────────┐ ┌──────────────────────────────┐     │ MessageBubble (target)│
   │ Return chip     │ │ Sync Engine (syncService)     │     │ reanimated one-shot   │
   │ (pop history)   │ │ syncNow → repository merge     │     │ pulse                 │
   └────────────────┘ └──────────────┬───────────────┘     └──────────────────────┘
                                      │
                    ┌─────────────────┴───────────────────┐
                    ▼                                       ▼
          ┌──────────────────┐               ┌──────────────────────────────┐
          │ SQLite (messages) │◀─────────────▶│ messageService.getMessages    │
          │ getWindowAround   │  server miss  │  getMessagesAround (new, opt) │
          └──────────────────┘               │  Realtime → add/update/remove │
                                              └──────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────┐
   │ scrollAnchorStore (persist) — Phase 9 durable reading position         │
   │ NEVER written by a jump (suppress-guarded).  jumpStore is RAM-only.    │
   └──────────────────────────────────────────────────────────────────────┘
```

Data-flow note: the Jump Scheduler touches only the FlashList **ref**, the RAM
`jumpStore`, and reads message data through the **existing** `chatStore` +
`cacheService`/`setRoomMessages` seam. It calls **no** service directly except the
read-only around-fetch through `cacheService`/`messageService`, preserving the
one-way data flow (Screen → Hook → Store/Service → Supabase).

---

## 17. Design Decisions & Telegram Comparison

| # | Decision | Why | Telegram parallel |
|---|---|---|---|
| D-J1 | **Generalize the Phase 9 proto-jump into one pipeline** shared by all sources | Search jump already exists; reuse its around-load + suppress + centering instead of a parallel mechanism | Telegram routes reply/search/pinned/mention through the same "jump to message" |
| D-J2 | **Fold the Jump Scheduler into `useScrollManager`** | It already owns the ref, `suppressRef`, and the proto-jump; a separate owner would fight for the ref | — (single controller) |
| D-J3 | **Module `jumpBus` for dispatch** | A reply bubble is deep in the tree; a bus avoids drilling a callback through `MessageList`→`MessageBubble`→`ReplyContext` | — (implementation) |
| D-J4 | **Around-window (`getWindowAround`) over an N-step paging loop** | One bounded centered SELECT reaches a deep target; O(window) not O(conversation) | Telegram loads a slice centered on the target |
| D-J5 | **Reuse `?focus=&at=` for cross-room jumps** | The Phase 9 deep-link + `initialScrollIndex` already renders *at* the target on mount — no post-paint jump | Telegram opens another chat already positioned |
| D-J6 | **Single highlight pulse, no repeat** | Brief warns against excessive animation; one wash communicates "here" without nagging | Telegram flashes the message once |
| D-J7 | **Jump history in RAM, not persisted** | A cross-restart jump trail is confusing/unbounded; reading position (the anchor) is the only thing worth persisting | Telegram keeps reading position across restart, loses the jump trail |
| D-J8 | **Down-pill for newer rows after a jump; no seamless downward pagination** | Downward re-hydration is O(page) and rare; the pill is the simple escape hatch and reuses Phase 9's component | Telegram shows a down-arrow after a jump |
| D-J9 | **New server `getMessagesAround` is optional & read-only** | Plain PostgREST select, embeds ride along, no RPC/type regen (mirrors `getRoomMessagesSince`); cache-only path works without it | — (server slice) |
| D-J10 | **Resolve the target index at scroll time from the live array** | Sync/realtime may mutate the window mid-jump; a snapshot index would scroll to the wrong row | — (consistency) |
| D-J11 | **A jump never writes the durable anchor (suppress-guarded)** | The reading position the user *chose* must survive jumping around | Telegram's "unread"/position is separate from jump navigation |
| D-J12 | **Everything flag-gated & additive (`FEATURE_SCROLL_TO_MESSAGE`)** | Matches the repo's Phase 4/5A/7/8/9/10 discipline; instant rollback; zero cost when off | — |

### Where we intentionally diverge from Telegram

- **No persisted jump trail** (D-J7) — matches mobile mental model on restart.
- **No seamless downward pagination** after a jump (D-J8) — a "jump to latest" pill
  instead of infinite down-scroll; simpler and bounded.
- **Highlight is a single gentle wash** (D-J6) — no repeated flashing.

---

## 18. Architectural invariants

These must hold in every implementation of this phase. Each maps to a diagnostics
assertion (Phase 6B `consistencyAuditor` style, kind `jump-drift`) so a violation is
observable, not silent.

| # | Invariant |
|---|---|
| I-J1 | **A jump never mutates the durable scroll anchor.** The Prepare→Load→Scroll sequence runs suppress-guarded; only genuine resting scroll writes `scrollAnchorStore`. |
| I-J2 | **Flag-off is byte-identical to today.** With `FEATURE_SCROLL_TO_MESSAGE=false`: reply previews are non-interactive, `jumpBus`/`jumpStore` are never touched, notifications open at bottom, and the only jump is the Phase 9 search `?focus=&at=` path exactly as now. |
| I-J3 | **O(window), never O(conversation).** A jump loads/renders at most `2×JUMP_WINDOW_RADIUS` rows; no full-history load or scroll-through ever occurs. |
| I-J4 | **The message list never re-renders for jump/highlight/history.** Scheduler state is non-reactive refs; the highlight is a single-target selector; the return chip is a separate component. |
| I-J5 | **Any jump failure degrades to nearest-neighbor, else bottom** — never an error, blank, or hung spinner. |
| I-J6 | **Exactly one jump is active at a time.** A new request supersedes the old via a single slot + generation counter; no two `scrollToIndex` calls race. |
| I-J7 | **Target index is resolved from the live array at scroll time**, so concurrent sync/realtime/pagination can't scroll to a stale row. |
| I-J8 | **`maintainVisibleContentPosition` behavior is unchanged**; the target is held by id, media/insert relayout above it doesn't move it, and the highlight stays on the correct bubble. |
| I-J9 | **`temp-` ids are never jump targets** and never pushed to history. |
| I-J10 | **The one-way data flow is preserved** — the scheduler reads data only through `chatStore` + `cacheService`; the sole network read is the bounded around-fetch through the service seam. |

---

## 19. Rollout strategy

1. **Flag default `false`.** Ship the `jumpStore`, `jumpBus`, scheduler additions,
   highlight, return chip, and the optional server around-fetch dormant. Flag-off
   path proven identical to today (I-J2).
2. **Internal dogfood with flag on.** Verify each source (search, reply, pinned,
   notification cold-start, mention, unread), resident/SQLite/server/deleted/offline
   resolution, chained jumps + return, and the no-anchor-drift guarantee on iOS +
   Android (keyboard open, media-heavy rooms, long backlogs).
3. **Diagnostics on** (`FEATURE_RELIABILITY_DIAGNOSTICS`): watch `jump-drift`
   assertions and jump-latency / resolution-class / fallback-rate gauges.
4. **Gradual enable**, then default `true`. Rollback at any point is flipping the
   flag back to `false`.

Independent of `FEATURE_DELTA_SYNC`, `FEATURE_OFFLINE_OUTBOX`,
`FEATURE_MEDIA_PIPELINE`, `FEATURE_LOCAL_SEARCH`, `FEATURE_INTELLIGENT_PREFETCH`,
`FEATURE_PUSH_PRESENCE`. It **builds on** `FEATURE_SCROLL_RESTORE` (reuses the Scroll
Manager, around-load, suppress guard, pill); if scroll restore is off, cross-room
`?focus=&at=` still works (Phase 9 handles it independently) but in-room repeat
jumps and history require the manager to be active — so Phase 11 should be enabled
together with, or after, `FEATURE_SCROLL_RESTORE`.

---

## 20. Implementation checklist (for the build phase)

Design is decision-complete; the build phase should need no further architecture.

- [ ] Add `FEATURE_SCROLL_TO_MESSAGE` (default `false`), `JUMP_WINDOW_RADIUS`
  (= `MESSAGES_PER_PAGE`), `JUMP_HIGHLIGHT_DURATION_MS` (~1500),
  `JUMP_HIGHLIGHT_FADE_IN_MS`/`_FADE_OUT_MS`, `JUMP_LOAD_TIMEOUT_MS` (~6000) to
  `src/lib/constants.ts`. (`JUMP_STACK_MAX` already exists.)
- [ ] `src/stores/jumpStore.ts` — **non-persisted** Zustand store: `historyByRoom`,
  `highlightByRoom`, actions `pushHistory`/`popHistory`/`setHighlight`/`clearHighlight`
  /`clearRoom`/`reset`; wired into the global logout `reset`.
- [ ] `src/lib/jumpBus.ts` — module singleton: `register(roomId, handler)`,
  `unregister(roomId)`, `request(target)`; forwards in-room or navigates cross-room.
- [ ] `src/hooks/useScrollManager.ts` — add the **Jump Scheduler**: `requestJump`,
  single-slot + generation/AbortController, resolution ladder (§4), reuse
  `scrollToRenderedId`/`suppressRef`/`getRoomMessagesAround`; register/unregister on
  the bus; publish highlight token; push/pop jump history. Generalize the existing
  `jumpedRef` search effect to route through the scheduler.
- [ ] `cacheService` / `messageService.getMessagesAround(roomId, around, radius)` —
  optional read-only server around-select (two selects, merged newest-first), with
  `cacheService.saveMessages` write-through. Cache-only path works without it.
- [ ] `MessageBubble` / `ReplyContext` — wrap the reply preview in a `Pressable` →
  `jumpBus.request`; add the reanimated one-shot highlight driven by the `jumpStore`
  selector; reject `temp-`/deleted appropriately.
- [ ] `PinnedMessagesSheet` — per-row tap → `jumpBus.request` + close sheet.
- [ ] `useNotifications` — append `?focus=&at=` when the push payload carries
  `messageId`/`createdAt`.
- [ ] Return chip component (or extend `NewMessagesPill`) — visible while
  `historyByRoom[roomId]` is non-empty; tap → `popHistory` + jump back.
- [ ] Diagnostics — `jump-drift` auditor kind + jump-latency/resolution-class/
  fallback-rate gauges (Phase 6B style), gated by `FEATURE_RELIABILITY_DIAGNOSTICS`.
- [ ] Vietnamese strings in `locales/*/chat.json`: "không tìm thấy tin nhắn", "đã
  cuộn tới vị trí gần nhất", "không có sẵn khi ngoại tuyến", "Không thể mở tin nhắn",
  return-chip label.
- [ ] Verify invariants I-J1..I-J10; confirm flag-off byte-identical behavior.

---

## 21. New constants / stores / files summary

| Kind | Name | Purpose |
|---|---|---|
| Flag | `FEATURE_SCROLL_TO_MESSAGE` | Master gate (default `false`). |
| Const | `JUMP_WINDOW_RADIUS` | Rows each side of the target for around-load (= `MESSAGES_PER_PAGE`). |
| Const | `JUMP_HIGHLIGHT_DURATION_MS` / `_FADE_IN_MS` / `_FADE_OUT_MS` | Highlight timings. |
| Const | `JUMP_LOAD_TIMEOUT_MS` | Bounds a server around-fetch. |
| Const | `JUMP_STACK_MAX` *(exists)* | Jump-history cap (10). |
| Store | `src/stores/jumpStore.ts` (RAM) | Jump history + highlight token, per room. |
| Lib | `src/lib/jumpBus.ts` | Source→manager dispatch singleton. |
| Hook | `useScrollManager` (extended) | Jump Scheduler + pipeline. |
| Service | `messageService.getMessagesAround` (optional) | Read-only server around-slice. |
| UI | Return chip (new or `NewMessagesPill` extension); tappable `ReplyContext`; pinned-sheet row jump | Affordances. |

No migration, no new table, no new realtime channel, no service-contract change.
```

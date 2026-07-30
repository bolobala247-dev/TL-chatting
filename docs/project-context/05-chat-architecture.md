# 05 — Chat Architecture (Current Implementation)

> This documents the implementation **as it exists today**. No redesign proposals. Key files: `app/chat/[roomId].tsx`, `src/hooks/useMessages.ts`, `src/hooks/useRealtime.ts`, `src/stores/chatStore.ts`, `src/stores/roomStore.ts`, `src/services/messageService.ts`, `src/components/chat/MessageList.tsx`.

## Layering

```
app/chat/[roomId].tsx  (ChatScreen — orchestrates everything)
   ├─ useMessages(roomId)        → chatStore + messageService + useRealtimeMessages
   ├─ useRoomParticipants(roomId)→ chatStore.participantsByRoom
   ├─ useTypingIndicator(roomId) → Supabase Presence channel
   ├─ usePeerPresence(peerId)    → get_peer_profile RPC polling (DMs)
   ├─ useDraftStore              → persisted per-room drafts
   └─ MessageList → MessageBubble (memoized, FlashList v2)
```

State is Zustand only — **no React Query**. All server access goes through `src/services/*`.

## Room Lifecycle

### Opening a Room

1. `ChatScreen` extracts `roomId` from the route.
2. `useMessages(roomId)` runs on mount:
   - `chatStore.setActiveRoom(roomId)` — used by the notification handler to suppress banners for the open room
   - `chatStore.fetchMessages(roomId)` — first page (20) via `messageService.getMessages`
   - `roomStore.clearUnread(roomId)` and `roomService.updateLastRead` → `mark_room_read` RPC (private watermark + optional public mirror)
3. `useRealtimeMessages(roomId)` subscribes the per-room channel (see Realtime below).
4. `roomService.getRoom(roomId)` loads room metadata; `useRoomParticipants` does a single participants fetch shared by the header and read receipts; DMs also start `usePeerPresence` polling.
5. Pinned messages, saved bookmarks, and pending scheduled messages are loaded by the screen.
6. A draft (if any) is seeded into the input from `draftStore`.

### Leaving / Switching Rooms

- Cleanup effect: `setActiveRoom(null)`, `updateLastRead` again (final watermark), remove the `room:${roomId}` channel and `typing:${roomId}` channel.
- **Messages are NOT evicted** — `chatStore.messages[roomId]` remains in memory, so returning to a room renders instantly from cache while realtime keeps it fresh (the first page is still refetched on mount).
- Switching rooms is a route change: the old screen unmounts (tearing down its channels), the new one mounts and repeats the open flow.

## Message Lifecycle

### Sending (optimistic update)

`useMessages.sendMessage`:

1. Build optimistic message with ID `temp-${Date.now()}`, prepend to `chatStore.messages[roomId]`.
2. `await messageService.sendMessage` (PostgREST INSERT).
3. Success → `chatStore.replaceOptimisticMessage(tempId, sent)`. Race-safe: if the realtime INSERT echo already added the real ID, the temp copy is simply dropped.
4. Failure → `chatStore.removeMessage(tempId, roomId)` and the error propagates.
5. After a confirmed send, an **undo window opens for 8000 ms** (`undoSend` hard-deletes the row and removes it from the store).

The same optimistic pattern is used by `sendAlbum` (local URIs shown as attachments while uploads run), `sendPoll`, `toggleReaction` (optimistic add/remove with revert), and `votePoll` (single-choice with revert).

### Editing / Deleting

- Edit: `messageService.updateMessage` then `chatStore.updateMessage` patch. Edit window enforced per project docs.
- Recall ("delete for everyone"): `messageService.deleteForEveryone` soft-deletes (sets `deleted_at`/`deleted_by`, wipes content/media/attachments); a DB trigger makes recalled rows immutable afterwards; associated storage objects are removed best-effort.

### Receiving via Realtime

- Per-room channel INSERT → `chatStore.addMessage` (deduplicates by ID against optimistic entries).
- UPDATE → `chatStore.updateMessage`, which merges the payload while **preserving locally embedded reactions/votes** that postgres_changes payloads don't carry.
- Global channel INSERT → room-list preview update + `incrementUnread` when the room isn't active.

## Realtime Channels

`src/hooks/useRealtime.ts`:

### `useRealtimeMessages(roomId)` — channel `room:${roomId}`

postgres_changes listeners, all filtered by `room_id=eq.${roomId}`:

| Table | Events | Effect |
|-------|--------|--------|
| `messages` | INSERT / UPDATE / DELETE | add / merge / remove in chatStore |
| `message_reactions` | INSERT / DELETE | patch reaction embeds |
| `poll_votes` | INSERT / UPDATE / DELETE | patch vote embeds |
| `room_participants` | UPDATE | live read-receipt watermark updates |

Reconnect: on `CHANNEL_ERROR`/`TIMED_OUT`, resubscribe after `RESUBSCRIBE_DELAY_MS` = 3000 ms; after a drop, the **latest page is refetched** to recover missed messages (no event replay). Channel removed on unmount/room change.

### `useRealtimeRooms()` — channel `global:messages` (mounted once at root)

- `messages` INSERT **with no filter** (all rooms): updates the room-list preview, increments unread when not the active room; sender display names resolved via a profile lookup behind an **LRU cache (max 200 entries)**.
- `room_participants` INSERT/DELETE (no filter): triggers a full room-list resync.
- `room_participants` UPDATE + `room_reads` INSERT/UPDATE: clears unread when the user's read position advances on another device.
- An `AppState` listener resyncs on foreground return (Android WebSocket teardown recovery).

## Pagination & Infinite Scrolling

- Page size: `MESSAGES_PER_PAGE` = **20** (`src/lib/constants.ts`).
- Cursor-based: `messageService.getMessages` orders by `created_at DESC`, uses `.lt("created_at", cursor)` for older pages.
- `chatStore.fetchMessages` appends pages, dedupes by ID via a Map, sorts newest-first; `hasMore[roomId] = page.length >= 20`.
- `useMessages.loadMore` reads state imperatively (stable callback for FlashList) and passes the oldest message's `created_at` as cursor.
- Trigger: FlashList `onStartReached` with threshold **0.2** (scrolling up toward older history).

## Cache & Query Strategy

- **In-memory only**: `chatStore.messages: Record<roomId, MessageWithMeta[]>` and `participantsByRoom`. Kept when leaving a room; cleared only by `chatStore.reset()` on logout. **No eviction policy** — memory grows with rooms visited per session.
- **No offline support / no local message persistence**: no SQLite, no AsyncStorage message cache. Fresh app start refetches everything. There is no outbound queue — sending while offline fails and removes the optimistic message.
- Persisted state is limited to: drafts (`talo-drafts`, debounced 400 ms), recent emojis (`talo-recent-emojis`), theme, language — all AsyncStorage via `zustand/persist` or direct keys.
- Query strategy: room list via the `get_user_rooms` RPC (server computes previews + unread counts); message pages via direct PostgREST selects; search via the `search_messages` RPC.

## Image Loading & File Upload

- **Picking**: `expo-image-picker`, multi-select up to `MAX_ALBUM_IMAGES` = 10, quality 0.8 (`handlePickPhotos` in the chat screen).
- **Upload**: `messageService.sendAlbumMessage` uploads all images **in parallel** to the `chat-media` bucket (`{roomId}/{timestamp}-{index}.jpg`), URI → ArrayBuffer via `fetch()`; one message row stores `media_url` (first image) + `attachments` (all URLs). Single image path: `{roomId}/{Date.now()}.jpg`.
- **Rendering**: `expo-image` with `cachePolicy="memory-disk"` and `recyclingKey` (AlbumGrid, Avatar, Emoji). Public URLs — no signed URL flow.
- **Cleanup**: recalling a media message extracts object paths from URLs and best-effort deletes them from storage.
- Generic file upload UI: **not found in repository** (schema supports `type = 'file'`; picker is image-only per `docs/reports/FEATURE_ANALYSIS.md`).

## Typing Indicator

`src/hooks/useTypingIndicator.ts` — Supabase **Presence** channel `typing:${roomId}`, key = userId:

- Privacy-gated by `typing_indicators_enabled`.
- `startTyping`: edge-detected (only tracks on off→on), debounced at `TYPING_DEBOUNCE_MS` = 2000 ms, auto-untrack after `TYPING_TIMEOUT_MS` = 5000 ms.
- Presence sync handler filters out self and uses stable-identity comparison to avoid re-renders. Channel removed on unmount.

## Read Receipts

Watermark-based — **no per-message receipt rows**:

- Private truth: `room_reads.last_read_at` (owner-only RLS, realtime-enabled for cross-device sync). Public mirror: `room_participants.last_read_at`, written only when the user has `read_receipts_enabled` (via `mark_room_read` RPC).
- `src/lib/receipts.ts`: `hasSeen` compares participant watermark vs `message.created_at`; `getSeenWatermark` collapses other participants to the **minimum** watermark; a message shows "seen by all" iff that collapsed watermark passes its creation time. Ticks: single check = sent, double = seen by all.
- Marked read on room open and on leave; live updates arrive via the per-room `room_participants` UPDATE listener.
- Unread counts: computed server-side in `get_user_rooms` (excludes own messages), maintained client-side by `incrementUnread`/`clearUnread`.

## Notifications

- Pipeline: `messages` INSERT → DB trigger (Vault-configured secret) → pg_net → `send-push-on-message` edge function → Expo Push API → FCM. **Android only**.
- Foreground: `setNotificationHandler` suppresses alert/sound/badge when `data.roomId === chatStore.activeRoomId`.
- Tap: `Notifications.useLastNotificationResponse` (cold-start and warm, with a dedup ref) → `router.push('/chat/${roomId}')`.
- Token sync: registered on mount and on every foreground return (token rotation); install-ID in SecureStore prevents deleting sibling-device tokens; dead tokens pruned by the edge function.

## Scroll Restoration & Message Rendering

- `MessageList` (memoized) uses **FlashList v2** with data reversed once via `useMemo` (store is newest-first; list renders chronological).
- Bottom-up behavior via `maintainVisibleContentPosition` with `startRenderingFromBottom: true`, `autoscrollToBottomThreshold: 0.2`, `animateAutoScrollToBottom: false` (avoids stacking on the keyboard animation).
- Scroll position is preserved during pagination by `maintainVisibleContentPosition`; there is **no cross-navigation scroll restoration** (reopening a room starts at the bottom) and no scroll-to-message (documented as unreliable with cursor pagination in `FEATURE_ANALYSIS.md`).
- `MessageBubble` is `memo()`-wrapped; swipe-to-reply via Pan gesture + Reanimated shared values (trigger 56 px, max drag 88 px); renders reply context, album grid, poll, reactions, receipt ticks.
- Receipt-driven re-renders are collapsed into a single stable `seenWatermark` string passed as `extraData`.
- `keyboardDismissMode`: "interactive" (iOS) / "on-drag" (Android); scroll indicator hidden.

## Virtualization

FlashList v2 provides recycling/virtualization. No explicit `estimatedItemSize` is set (v2 auto-estimates) and no `getItemType` is used. The room list (`app/(tabs)/index.tsx`) still uses **FlatList** with pull-to-refresh (a noted FlashList-migration leftover).

## Offline Support & Local Persistence

- Offline support: **none**. No connectivity detection library, no queued sends, no cached message history.
- Local persistence: drafts and recent emojis only (AsyncStorage); session and secrets in SecureStore. Messages, rooms, and participants are RAM-only.

## Current Bottlenecks (evidence-based)

1. **Unfiltered `global:messages` channel** — every client receives every message INSERT in the system; called out as the scaling ceiling in `PRODUCTION_CHECKLIST.md`.
2. **Full refetch on reconnect** — both realtime hooks recover from drops by refetching (first page / full room list); no gap-fill or event replay.
3. **Unbounded in-memory message cache** — no eviction across visited rooms within a session.
4. **Sender-name N+1** on the room list (mitigated by the 200-entry LRU, still one query per unknown sender).
5. **Presence is polled** — peer online status polls `get_peer_profile` every 30 s rather than using a Presence channel.
6. **Single shared `loading` flag** in chatStore across all rooms — concurrent fetches can produce incorrect loading states.
7. **`get_user_rooms` scans message history** per room for unread counts (flagged in `NOTIFICATION_AUDIT.md` perf findings).
8. **804-line chat god-screen** (`app/chat/[roomId].tsx`) concentrates orchestration (flagged in `PRODUCTION_CHECKLIST.md`).

## Current Limitations (evidence-based)

- No offline mode, no message persistence, no outbound queue.
- Push notifications Android-only; no iOS/web push; no message grouping or reply-from-notification; no app-icon/tab-bar total badge.
- No scroll-to-message (pinned banner cannot jump to the message).
- Thread fetching (`getThreadMessages`) is unbounded — no pagination (flagged in `PRODUCTION_CHECKLIST.md`).
- No delete-for-me, no edit history, no link previews, no video capture UI (deliberate scope cuts, `FEATURE_ANALYSIS.md` §4).
- Chat media is publicly readable (public bucket, guessable-ish paths).

# 07 — Performance

## Implemented Optimizations

### React Query Cache

Not applicable — React Query is not used in this repository (zero matches). Caching is manual, in Zustand.

### Memory Cache

- `chatStore.messages` keeps every visited room's messages in RAM for the session — instant re-open of previously visited rooms.
- `participantsByRoom` cached per room, fetched once and shared by the header and read receipts.
- Sender-name **LRU cache (max 200 entries)** in `useRealtimeRooms` avoids repeated profile lookups for room-list previews.
- WebRTC session objects (peer connection, timers, ICE queue) intentionally kept outside the Zustand store to avoid render churn.

### Local (Persistent) Cache

- Drafts (`talo-drafts`, saves debounced 400 ms) and recent emojis (`talo-recent-emojis`) via `zustand/persist` + AsyncStorage.
- Theme preference and language choice in AsyncStorage; read **before first paint** to avoid flashes.
- Push token + synced marker in SecureStore to skip redundant DB writes across restarts.
- **No persistent cache for messages, rooms, or profiles.**

### Image Cache

`expo-image` with `cachePolicy="memory-disk"` and `recyclingKey` in AlbumGrid, Avatar, and Emoji components. Web assets get immutable 1-year `Cache-Control` headers via `vercel.json` (`/_expo/static/*`, `/assets/*`).

### Pagination / Infinite Query

- Messages: cursor-based (`created_at <` cursor), 20 per page, triggered by FlashList `onStartReached` (threshold 0.2), with per-room `hasMore` flags and ID-dedup on append.
- Search: cursor-paginated `search_messages` RPC (limit clamped 1–50).
- Not paginated: thread messages (`getThreadMessages` is unbounded — flagged) and the room list (full RPC result).

### Prefetching

**None.** No `Image.prefetch`, no router prefetch, no data prefetch APIs found anywhere in `src/`.

### Bundle Optimization

- Per-weight Inter font subpath imports (4 weights instead of the 18-weight, ~7 MB package root).
- Lazy/Suspense splitting of every heavy sheet/modal (10 in the chat screen), CallScreen/IncomingCallOverlay, EmojiPicker.
- Static web export with Metro; SPA + immutable asset caching on Vercel.
- **Native build speed** (documented in `docs/reports/BUILD_PERFORMANCE_AUDIT.md`, applied via `plugins/withGradleBuildOptimizations.js` + `eas.json`): Gradle heap 4096 m / metaspace 1024 m, parallel builds, Gradle caching, PNG crunch off in release, `EAS_USE_CACHE=1` (ccache) on all profiles, release ABIs cut to `armeabi-v7a,arm64-v8a`. Expected warm-cache Gradle time ~5–7 min (from 10–12).

### Rendering Optimization

- `MessageList`, `MessageBubble`, `EmojiCell` are `React.memo`-wrapped.
- `renderItem`, `keyExtractor`, list headers are `useCallback`'d; message array reversed once via `useMemo`.
- Read-receipt watermarks collapsed to one stable string (`seenWatermark`) passed as `extraData`, so bubbles only re-render when a read position actually moves.
- `loadMore` reads store state imperatively to keep the callback identity stable for FlashList.
- Keyboard animation runs on the UI thread (`react-native-keyboard-controller`); `animateAutoScrollToBottom: false` prevents animation stacking.
- Typing-presence handler uses stable-identity comparison to avoid re-renders.
- Store consumers select individual fields (per project convention).

### Virtualization

FlashList v2 in: chat messages, emoji picker, search results, saved messages, blocked users, media gallery. Chat list renders bottom-up via `maintainVisibleContentPosition` + `startRenderingFromBottom`.

### Memoization

Covered above (memo/useMemo/useCallback across the chat surface). Theme colors and i18n resources are static/module-level.

## Currently Missing (evidence-based)

| Gap | Evidence |
|-----|----------|
| No server-cache layer (React Query/SWR): no stale-while-revalidate, retries, or request dedup | zero matches; manual Zustand pattern |
| No prefetching of any kind (images, routes, next page) | no prefetch API usage in `src/` |
| No `getItemType` on FlashList (mixed bubble types share one recycling pool) | `MessageList.tsx` |
| No explicit `estimatedItemSize` on the chat FlashList | `MessageList.tsx` |
| Room list still `FlatList` (FlashList migration leftover) | `app/(tabs)/index.tsx`, `PRODUCTION_CHECKLIST.md` |
| No memory eviction for the per-room message cache | `chatStore.ts` |
| No offline/persistent data cache (messages refetched on every cold start) | no SQLite/AsyncStorage message store |
| Unfiltered `global:messages` realtime channel — O(total system messages) client traffic | `useRealtime.ts`, `PRODUCTION_CHECKLIST.md` blocker |
| Full refetch on realtime reconnect instead of gap-fill | `useRealtime.ts` |
| `get_user_rooms` unread counts scan message history per room | `NOTIFICATION_AUDIT.md` |
| Peer presence polled every 30 s (latency + query load) | `usePresence.ts` |
| Thread fetch unbounded | `PRODUCTION_CHECKLIST.md` |
| ~9 whole-store Zustand subscriptions remain | `PRODUCTION_CHECKLIST.md` |
| No image resizing/compression pipeline beyond picker quality 0.8; originals uploaded and served | `messageService.ts` |
| No service worker on web (no offline shell, no web asset precache) | `public/` contains manifest only |
| Bundle analysis / size budget tooling | Not found in repository |

# 06 — Frontend Architecture

## Folder Organization

```
app/                      # Routes only (Expo Router file-based)
src/components/           # Presentational components (ui/ chat/ rooms/ call/)
src/hooks/                # Orchestration: stores + services + realtime
src/stores/               # Zustand state
src/services/             # All Supabase access
src/lib/                  # Client singleton, constants, platform utilities
src/theme/                # ThemeProvider + semantic tokens
src/i18n/                 # i18next setup + typed resources
src/types/                # Generated DB types + domain aliases
```

Enforced one-way data flow (AGENTS.md): **Screen → Hook → Store/Service → Supabase**. Components never call `supabase.from()`. Imports use the `@/` alias with `import type` for types.

## Feature Organization

Features are organized **by layer, not by feature folder**. A feature (e.g., polls) spans: `src/services/pollService.ts` + actions in `useMessages` + `chatStore` patches + `src/components/chat/Poll*` + strings in `locales/*/chat.json`. Route-level features map 1:1 to `app/` files (search, saved-messages, settings/privacy, settings/app-lock, settings/blocked-users, chat/media).

## Providers

Mounted in `app/_layout.tsx` in this exact order:

```
GestureHandlerRootView
└─ KeyboardProvider                (react-native-keyboard-controller)
   ├─ ThemeProvider                (custom; NativeWind color scheme + persistence)
   │  └─ ThemedApp
   │     ├─ StatusBar              (follows resolved scheme)
   │     └─ AppLockGate            (PIN/biometric — above everything incl. auth)
   │        └─ AuthGate            (session redirect + root hooks + native Stack + CallHost)
   └─ VercelInsights               (web-only analytics sibling)
```

First paint is gated on three flags: fonts loaded (4 Inter weights), i18n initialized, theme bootstrap done — the splash screen (`preventAutoHideAsync`) hides only when all resolve, so there is no theme/locale flash.

`AuthGate` also mounts the root-level hooks: `useNotifications`, `usePresenceHeartbeat` (both only when authenticated), and `useRealtimeRooms` (always, so unread badges work everywhere including notification deep links). Redirects: unauthenticated outside `(auth)` → login; authenticated inside `(auth)` (except reset-password) → tabs.

## Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | Runs `authStore.initialize` once; re-exports auth state |
| `useMessages` | Message fetch/send/paginate/react/vote/undo for a room; composes `useRealtimeMessages` |
| `useRealtime` | `useRealtimeMessages(roomId)` (per-room channel) + `useRealtimeRooms()` (global channel) |
| `useRooms` | Room list fetch via roomStore |
| `useRoomParticipants` | Single participants fetch per room, shared by header + receipts |
| `useTypingIndicator` | Presence-based typing with debounce/timeouts |
| `usePresence` | `usePresenceHeartbeat` (own heartbeat) + `usePeerPresence` (30 s peer polling) |
| `useNotifications` | Push token sync, foreground suppression, tap deep-linking |
| `useCalls` | Root listener on the `calls` table; raises incoming-call UI |
| `useCooldown` | Countdown timer (app-lock lockout) |

## Contexts

Only one React Context: **ThemeProvider** (`src/theme/ThemeProvider.tsx`) exposing `useTheme`/`useThemeColors`. i18n uses react-i18next's provider implicitly. Everything else is Zustand.

## Global Stores (Zustand v5)

| Store | Contents | Persisted |
|-------|----------|-----------|
| `authStore` | session, user, profile, initialized, loading + auth actions | No (session lives in SecureStore via supabase-js) |
| `chatStore` | `messages` by roomId, `hasMore` by room, single `loading`, `activeRoomId`, `participantsByRoom` | No |
| `roomStore` | rooms list (bookmarks-first sort), loading, error, unread ops | No |
| `callStore` | call phase/peer/streams/toggles; non-render refs (RTCPeerConnection, timers, ICE queue) deliberately kept outside the store | No |
| `privacyStore` | settings, blocked list, loading flags; optimistic updates with revert | No |
| `draftStore` | per-room draft text | **Yes** — AsyncStorage `talo-drafts` |
| `emojiStore` | max 24 recent emojis (MRU) | **Yes** — AsyncStorage `talo-recent-emojis` |

Convention: select individual fields (`useStore((s) => s.field)`) — though `PRODUCTION_CHECKLIST.md` notes ~9 whole-store subscription sites remain.

## React Query Usage

**Not used.** Zero `@tanstack`/`useQuery` matches in the repository. Data fetching is service modules + Zustand; realtime channels push updates into stores.

## Error Handling

- **ErrorBoundary**: only expo-router's built-in, re-exported from the root layout. No custom boundary.
- **Forms/user feedback**: inline `FormMessage` component (accessibilityRole alert; danger/success/info tones). Project rule: no `Alert.alert` (unreliable on web); destructive confirms use `ConfirmDialog`.
- **Stores/services**: services `throw` on Supabase error; stores either swallow-and-log (`console.error` with bracket tags) on fetch paths or revert-and-rethrow on optimistic paths. `authErrors.ts` maps Supabase auth errors to localized messages, with a dev-only `console.warn` for raw errors.
- **Gaps noted in `PRODUCTION_CHECKLIST.md`**: `authStore.initialize` lacks a catch, no global unhandled-rejection handler, no crash reporting (Sentry absent), ~20 silent catch-and-log sites, ~48 raw console calls.

## Loading Strategy

Loading flags live in stores (`loading`, `blockedLoading`, per-room `hasMore`); screens render `Spinner`/`EmptyState`/skeleton-free states per the design system (Skeleton is a deferred component). Room list uses pull-to-refresh. `AuthGate` shows a full-screen spinner until session initialization completes.

## Suspense, Code Splitting & Lazy Loading

Suspense is used **for code splitting only**, never data fetching:

- `app/chat/[roomId].tsx` lazy-loads **10 sheets/modals** (ReadReceipts, Attachment, ImageViewer, PollComposer, Pinned, Schedule ×2, ContactInfo, GroupInfo, ReportUser) inside a single `<Suspense fallback={null}>`.
- `CallHost` lazy-loads `CallScreen` and `IncomingCallOverlay`.
- `MessageInput` lazy-loads `EmojiPicker`.
- Fonts: per-weight Inter subpath imports keep ~7 MB of unused weights out of the bundle.
- No route-level manual splitting beyond what Expo Router provides; no dynamic `import()` elsewhere.

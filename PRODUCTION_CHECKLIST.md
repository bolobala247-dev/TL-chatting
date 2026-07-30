# Production Readiness Checklist — Talo

> Analysis date: 2026-07-29 · Scope: read-only review of the full repository.
> Legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low · ✅ Already good (keep as-is)

**Verdict: NOT production-ready yet.** Core architecture is solid (clean service layer, hardened RLS, correct realtime cleanup, secure session storage), but there are blocking gaps: publicly readable chat media, an unfiltered global realtime channel, zero crash reporting, zero tests/lint, and dev environments pointing at the production database.

---

## 1. Security

### Blockers

- [ ] 🔴 **`chat-media` bucket is public-read** — `supabase/migrations/00007_storage_buckets.sql` (L5-L9, L40-L41) creates `chat-media` as a PUBLIC bucket with `FOR SELECT USING (bucket_id = 'chat-media')`. Anyone with a URL can view private chat images; paths (`{roomId}/{timestamp}.jpg`) are semi-guessable. Migrate to a private bucket + signed URLs, and restrict SELECT to room participants (mirror the existing insert policy).
- [ ] 🟠 **No delete/update storage policy for `chat-media`** — uploaded chat images can never be removed by their owners, and recalled image messages leave the file publicly accessible forever.
- [ ] 🟠 **`.env.development` points at the production database** — both `.env.development` and `.env.production` reference `elevsuvbbittizjxrfll` (prod). Local dev runs against prod data. Point dev at the dev project (`xoxnjqgumfhzwturtfhz`, already used in `eas.json` dev/preview profiles).

### Should fix

- [ ] 🟡 **Weak password policy** — 6-char minimum, client-side only (`app/(auth)/register.tsx` L60, `reset-password.tsx` L98), no complexity rules. Enforce a stronger minimum (8+) client-side AND in Supabase Auth settings (dashboard: min length + leaked-password protection).
- [ ] 🟡 **Username → email resolution surface** — `authStore.signIn` (L138-L144) resolves email from username via `profileService.getEmailByUsername`. Verify the backing RPC does not let an attacker enumerate emails for arbitrary usernames (should return only what's needed for login, rate-limited).
- [ ] 🟡 **Anon keys committed in `eas.json`** — anon keys are publishable by design, but committing them couples key rotation to git history. Prefer EAS environment variables / EAS secrets over inline `env` blocks.
- [ ] 🟢 **`.gitignore` ordering bug** — line 57 (`.env*`) re-ignores `.env.example` after the `!.env.example` negation on line 37. Harmless today, but the negation is dead; clean up the duplicate rules.
- [ ] 🟢 **App-lock PIN hashing** — single-round SHA-256 of salt+PIN (`appLockService.ts` L12-L17) is offline-brute-forceable for 4–6 digit PINs. Acceptable for a local UI lock behind Keychain, but note it in the threat model (or switch to multiple hash iterations).

### Already good ✅

- ✅ Only the anon key ships to the client; `service_role` is confined to the edge function via `Deno.env` (`send-push-on-message/index.ts` L153).
- ✅ Sessions stored in SecureStore (Keychain/Keystore) on native (`src/lib/supabase.ts` L7-L18).
- ✅ RLS enabled on all 13 tables; the original `USING (true)` profiles policy was fixed in `00010_privacy_controls.sql` (L259-L286); blocked-DM sends rejected at DB level.
- ✅ Edge function verifies a Vault-provisioned shared secret and re-reads the message from DB instead of trusting the payload (L132-L139, L161-L166).
- ✅ `.env*` files are NOT tracked in git (verified with `git ls-files`); `google-services.json` Firebase API key is public-by-design (OK).
- ✅ Mentions are regex-parsed and rendered as native `Text` — no injection surface.

---

## 2. Error Handling

- [ ] 🟠 **`authStore.initialize` can reject unhandled** — try/finally with no catch (`authStore.ts` L51-L77); a failing `getSession`/`fetchProfile` propagates as an unhandled rejection during app boot. Add a catch that still marks `initialized: true` and surfaces a retry state.
- [ ] 🟡 **~20 silent catch-and-log sites in stores/hooks** — e.g. `privacyStore.ts` L38-L83, `roomStore.ts` L106, `useMessages.ts`, `usePresence.ts` swallow errors after `console.error` with no user feedback or retry. Define a policy: which failures are silent (background sync) vs. surfaced (user actions like send/pin/block).
- [ ] 🟡 **No global unhandled-rejection handler** — add one (e.g. `ErrorUtils.setGlobalHandler` / `globalThis.addEventListener("unhandledrejection")` on web) wired to crash reporting.
- [ ] 🟡 **Stock error boundary only** — `app/_layout.tsx` L25 re-exports expo-router's default `ErrorBoundary`. Replace with a branded Vietnamese fallback screen that reports to the crash service.
- [ ] 🟢 **No offline send queue** — optimistic messages can strand if the app is killed mid-send. Acceptable for v1; document the behavior.

### Already good ✅

- ✅ Services use a consistent `if (error) throw error` pattern throughout `src/services/*`.
- ✅ Realtime channels reconnect after drops with a 3s timer and refetch missed data on resubscribe (`useRealtime.ts` L221-L234, L385-L412); Android foreground resync handled.

---

## 3. Logging

- [ ] 🔴 **No crash/error reporting service** — zero Sentry/Bugsnag/Crashlytics in `package.json`. Production crashes and JS errors are completely invisible. This is the single most important pre-launch gap: integrate `@sentry/react-native` (or equivalent) with source maps in EAS builds.
- [ ] 🟡 **~48 raw `console.*` calls ship to production** — ~23 in `src/`, ~25 in `app/`. Introduce a thin logger wrapper that gates on `__DEV__` and forwards errors to the crash service in production; add `babel-plugin-transform-remove-console` (keep `error`/`warn`) for release builds.
- [ ] 🟢 **No sensitive-data leaks found in logs** — error objects are logged, not tokens or message content; `authErrors.ts` L72-L83 correctly gates raw auth errors on `__DEV__`. Keep it that way.
- [ ] 🟢 **Local debug artifact** — `.cursor/debug-cb5cde.log` exists in the working tree (gitignored, so safe); delete locally.

---

## 4. Folder Structure

- [ ] 🟢 **Empty leftover root dirs** — `components/` and `constants/` at the repo root are empty remnants (real code lives in `src/components`, `src/lib/constants.ts`). Remove to avoid import confusion.
- [ ] 🟢 **Minor layering deviation** — `useRealtime.ts` L33-L37 queries `profiles` directly from the hook (sender-name cache) instead of via `profileService`. Only violation found; move for consistency.
- [ ] 🟢 **Local `android/` prebuild artifact** — gitignored (`.gitignore` L55) but present locally with a second `google-services.json`; regenerate via `npx expo prebuild` rather than maintaining by hand.

### Already good ✅

- ✅ The declared architecture is respected: **zero** `supabase.from()` calls in `app/` screens or `src/components` — all data access flows through `src/services/*`.
- ✅ Clear layering: `app/` (routes) → `src/hooks` → `src/stores`/`src/services` → `src/lib/supabase.ts`; types isolated in `src/types`.

---

## 5. Environment Variables

- [ ] 🟠 **Fix `.env.development`** — must reference the dev Supabase project, not prod (see Security §1).
- [ ] 🟡 **No fail-fast validation** — `src/lib/supabase.ts` L13-L14 uses non-null assertions (`process.env.EXPO_PUBLIC_SUPABASE_URL!`). A missing/misconfigured env produces a cryptic runtime crash. Add an explicit check with a descriptive error at module load.
- [ ] 🟡 **Move EAS build env to EAS environment variables** — inline `env` blocks in `eas.json` (L10-L39) work but bake keys into git; EAS env vars enable rotation without commits.
- [ ] 🟢 **`scripts/switch-env.js` has no content validation** — it blind-copies files; consider validating that required keys exist and printing which project ref is now active (guards against the dev-points-at-prod mistake).

### Already good ✅

- ✅ Only two `process.env` reads in app code, both correctly `EXPO_PUBLIC_`-prefixed; no server secrets referenced client-side.
- ✅ All `.env*` variants gitignored and confirmed untracked.

---

## 6. Performance

- [ ] 🟡 **Whole-store Zustand subscriptions at 9 sites** — `app/(tabs)/settings.tsx` L51, all four auth screens, `app/index.tsx` L6, `useRooms.ts` L7, and `useAuth` returning the entire store (L13). Every store update re-renders these consumers. Switch to per-field selectors (`useStore((s) => s.field)`) per the project's own rules.
- [ ] 🟢 **FlatList remnants** — rooms list `app/(tabs)/index.tsx` L108, contacts L136, and `CreateRoomModal` still use `FlatList` while the project convention is FlashList. Low impact at current list sizes; migrate for consistency.
- [ ] 🟢 **Per-room channel binding count** — an open chat registers 9 `postgres_changes` bindings on one channel (`useRealtime.ts` L64-L220). Fine for one room at a time; just avoid mounting multiple chat screens concurrently.

### Already good ✅

- ✅ FlashList for all heavy lists (messages, search, threads, saved, blocked); `MessageBubble` is `memo`-wrapped; `renderItem`/`keyExtractor` memoized.
- ✅ `expo-image` used for media (viewer, album grid, search).
- ✅ Cursor-based pagination, 20/page (`messageService.getMessages` L20-L38); reactions + poll votes joined in a single select.
- ✅ Every realtime effect returns `supabase.removeChannel(channel)` — no leak found.
- ✅ `get_user_rooms` uses `LEFT JOIN LATERAL ... LIMIT 1` for last messages and indexed unread counts — efficient shape.

---

## 7. Scalability

- [ ] 🟠 **Unfiltered `global:messages` channel is the scaling ceiling** — `useRealtime.ts` L302-L384 subscribes **every client** to ALL inserts on `messages`, `room_participants`, and `room_reads` with no filter. RLS gates delivery, but the server must evaluate RLS per row × per subscriber across the entire message firehose. This degrades superlinearly with users × message volume. Mitigations (pick one before scale):
  - Supabase Broadcast (`realtime.broadcast_changes`) from a DB trigger to per-user topics, or
  - per-room subscriptions for the visible room list only, or
  - a `user_room_events` fan-out table filtered by `user_id=eq.{uid}`.
- [ ] 🟡 **Unbounded thread query** — `messageService.getThreadMessages` (L161-L170) has no `.limit()`; a long thread loads everything in one request. Add pagination like the main message list.
- [ ] 🟡 **Unread counts recomputed per `get_user_rooms` call** — the lateral `COUNT(*)` per room (migration 00012 L188-L195) is fine now but becomes a hot query on large rooms; consider a maintained counter if room list refetches grow frequent (the global channel currently triggers `resync()` on membership changes).
- [ ] 🟢 **Push fan-out serializes** — the edge function loops Expo chunks of 100 sequentially and issues 4 sequential DB reads per message. Fine at current scale; parallelize chunks if send latency becomes visible.

### Already good ✅

- ✅ Push pipeline shape is right: DB trigger → Vault secret → edge function → Expo chunked send with `DeviceNotRegistered` dead-token cleanup (`index.ts` L264-L290).
- ✅ Message pagination is cursor-based (no OFFSET degradation).

---

## 8. Code Quality

- [ ] 🟠 **Zero tests** — no test files, no jest/testing-library config, no test deps. Before launch, add at minimum: unit tests for `src/lib/*` (mentions, receipts, authErrors), service-layer tests with a mocked Supabase client, and store logic tests (optimistic send/replace/rollback in `chatStore`).
- [ ] 🟠 **No ESLint/Prettier config** — devDependencies are only `typescript` + `@types/react`; an `eslint-disable-next-line` exists in `useMessages.ts` L63 with no config to back it. Add `eslint-config-expo` + `eslint-plugin-react-hooks` and a format check.
- [ ] 🟡 **No quality gate in CI** — `.eas/workflows/build-android-production.yml` auto-builds production on every push to `main` with no tsc/lint/test step before it. Add a check job (or GitHub Action) gating the build.
- [ ] 🟡 **God-screen: `app/chat/[roomId].tsx` (804 lines)** — handles edit/recall/pin/save/schedule/reply/album/poll in one file. Extract action-sheet + composer orchestration into hooks/components. Also large: `settings.tsx` (460), `useRealtime.ts` (422), `MessageBubble.tsx` (422), `search.tsx` (394).
- [ ] 🟢 **~17 `as any` casts** — concentrated in jsonb `metadata`/`attachments` casts (`useMessages.ts`, `messageService.ts` L239/L256, `roomService.ts` L98-L120). Define typed helpers for jsonb columns instead.
- [ ] 🟢 **Duplicated reconnect scaffolding** — `useRealtimeMessages` and `useRealtimeRooms` copy the same disposed/retryTimer/hadDrop machinery; extract a shared `useResilientChannel` helper.

### Already good ✅

- ✅ TypeScript strict mode; zero `@ts-ignore`/`@ts-expect-error`; zero TODO/FIXME/HACK in `src/`.
- ✅ Consistent conventions: `@/` imports, `import type`, function-declaration exports, NativeWind styling, Vietnamese UI strings via i18n.

---

## Launch-Blocking Summary (do these before go-live)

| # | Item | Category | Severity |
|---|------|----------|----------|
| 1 | Make `chat-media` bucket private + signed URLs, participant-scoped SELECT | Security | 🔴 |
| 2 | Integrate crash reporting (Sentry) + source maps | Logging | 🔴 |
| 3 | Replace unfiltered `global:messages` channel with scoped fan-out | Scalability | 🟠 |
| 4 | Point `.env.development` at the dev Supabase project | Env vars | 🟠 |
| 5 | Add catch to `authStore.initialize` + global rejection handler | Error handling | 🟠 |
| 6 | Add ESLint + minimal test suite + CI gate before production build | Code quality | 🟠 |
| 7 | Add delete/owner policies for `chat-media` objects | Security | 🟠 |

## Recommended Before Scale (post-launch)

- Strengthen password policy (8+ chars, leaked-password protection in Supabase Auth).
- Paginate `getThreadMessages`.
- Per-field Zustand selectors at the 9 whole-store sites.
- Fail-fast env validation in `src/lib/supabase.ts`.
- Split `app/chat/[roomId].tsx`; extract shared realtime reconnect helper.
- Migrate remaining `FlatList` usages to FlashList; remove empty root `components/`, `constants/` dirs.
- Move EAS build env from inline `eas.json` blocks to EAS environment variables.

# 11 — Technical Debt

> Repository-evidence only. Notably, a source-wide grep across `app/`, `src/`, `supabase/`, `scripts/`, `plugins/` found **zero** `TODO`, `FIXME`, `HACK`, `XXX`, or `@deprecated` markers and no commented-out disabled features. The debt is documented in markdown ledgers rather than in code comments.

## TODO / FIXME Markers

**None found in source.** (The only `temp-` matches are optimistic-message ID prefixes, not debt.)

## Deliberate Silent Catches / Suppressions (in code)

- 7 comment-only silent catch blocks, each with a rationale: i18n persistence (`src/i18n/index.ts`), push token storage (`pushTokenService.ts`), install-id fallback (`notificationService.ts` ×2), best-effort ICE / malformed candidate / closed peer connection (`callStore.ts` ×3), keep-previous-results on refresh failure (`app/(tabs)/contacts.tsx`).
- 3 `react-hooks/exhaustive-deps` disables (`app/search.tsx`, `app/chat/media.tsx`, `src/hooks/useMessages.ts`) — with **no ESLint config present to enforce the rule at all**.
- One `console.warn`: dev-gated auth-error logging in `src/lib/authErrors.ts` (intentional).

## Launch Blockers (`PRODUCTION_CHECKLIST.md`, all unchecked)

1. 🔴 `chat-media` bucket is **public-read**; paths semi-guessable (`{roomId}/{timestamp}.jpg`).
2. 🔴 **Zero crash reporting** (no Sentry or equivalent).
3. 🔴 **Unfiltered `global:messages` realtime channel** — the scaling ceiling.
4. 🟠 `.env.development` points at the **production** database (`elevsuvbbittizjxrfll`).
5. 🟠 `authStore.initialize` lacks a catch; no global unhandled-rejection handler.
6. 🟠 **Zero tests, no ESLint/Prettier, no CI quality gate.**
7. 🟠 (Historical entry) missing delete/update storage policies for `chat-media` — migration `00015_chat_media_delete_policy.sql` now adds them; the checklist item remains unchecked.

## Known Limitations (documented)

- Push: Android-only; no iOS/web push; no tab-bar/app-icon total-unread badge; tapping a notification for the already-open room re-pushes the route (cosmetic) — `NOTIFICATION_FIX_REPORT.md` §6.
- Push requires 7 manual per-environment setup steps that cannot be automated (Firebase, EAS credentials, Vault secrets, function deploy) — `NOTIFICATION_FIX_REPORT.md` §7.
- Scheduled messages have 1-minute delivery granularity (pg_cron) — `FEATURE_ANALYSIS.md` §5.
- App lock is a UI gate, not encryption; PIN hash is single-round SHA-256 (brute-forceable offline for short PINs) — `SECURITY_REVIEW.md` §5, `PRODUCTION_CHECKLIST.md`.
- Realtime channels are public (no private-channel auth); username→email RPC is an enumeration surface mitigated only operationally — `SECURITY_REVIEW.md` §5.
- No offline support / message persistence (RAM-only chat cache) — see `05-chat-architecture.md`.
- On-device notification scenarios were verified only by static code trace, not device testing — `NOTIFICATION_FIX_REPORT.md`.

## Incomplete Features

- Video messages: `messages.type` supports `video` but there is no capture/upload UI (picker is image-only).
- Generic file sending: `type = 'file'` exists in schema; no file-picker UI found.
- Delete-for-me, edit history, link previews, scroll-to-pinned-message: explicitly out of scope (`FEATURE_ANALYSIS.md` §4).
- Deferred design-system components: Toast, Tooltip, Checkbox, Switch, Dropdown, Progress, Skeleton (`DESIGN_SYSTEM.md` §16).

## Temporary Implementations / Leftovers

- Empty root-level `components/` and `constants/` directories (pre-restructure leftovers; flagged).
- Room list still uses `FlatList` (FlashList migration remnant).
- `useRealtime.ts` queries `profiles` directly — a documented deviation from the services-only layering.
- Duplicated realtime reconnect scaffolding across `useRealtime.ts` and `useCalls.ts` (same 3 s resubscribe pattern implemented twice).
- Migration `00011` accidentally dropped `get_user_rooms` features from `00010`; restored in `00012` (history preserved in migration comments).
- `local Gradle release build signs with the debug keystore` (different signature from EAS builds) — `how-to-build-local.md` caveat.
- Stock Expo-template LICENSE copyright header (650 Industries) rather than a project-specific one.

## Should Be Improved Later (documented backlog)

From `PRODUCTION_CHECKLIST.md` "should fix / before scale":

- Weak password policy (6-char minimum, client-side only).
- Anon keys committed inline in `eas.json` (should be EAS env vars/secrets).
- ~20 silent catch-and-log sites; ~48 raw `console.*` calls (no logging abstraction).
- 804-line `app/chat/[roomId].tsx` god-screen — split.
- ~17 `as any` casts on JSONB columns.
- ~9 whole-store Zustand subscriptions (should be per-field selectors).
- Unbounded `getThreadMessages` query — add pagination.
- `scripts/switch-env.js` does no content validation; no fail-fast env validation at startup.
- `.gitignore` ordering bug: `.env*` re-ignores `.env.example` after its negation.

From `BUILD_PERFORMANCE_AUDIT.md` §5 (unapplied): possibly-unused `expo-web-browser`, `expo-dev-client` cost in prod builds, **APK-vs-AAB conflict** (Play submit requires AAB but production profile builds APK), Gradle configuration cache, `.easignore`, unused Android permissions (RECORD_AUDIO, SYSTEM_ALERT_WINDOW).

## Documentation Debt

- `AGENTS.md` (DB schema section) and `docs/SETUP.md` still describe the original 4-table schema; the real schema is 15 tables / 16 migrations.
- `UI_MIGRATION_PLAN.md` frozen at "Awaiting approval" though the plan was executed (status not updated).

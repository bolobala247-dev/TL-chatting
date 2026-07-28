# Notification Fix Implementation Report

> Date: 2026-07-28 · Implements all fixes from `NOTIFICATION_AUDIT.md` (P1–P15)
> Verification: `npx tsc --noEmit` clean · static code-trace of every scenario (device testing requires a new EAS build — see Manual Setup)

---

## 1. Files Changed

| File | Audit IDs | Why |
|---|---|---|
| `app.json` | P1 | Added `android.googleServicesFile: "./google-services.json"` so FCM is compiled into EAS builds. Without it no push token can ever be issued. |
| `supabase/migrations/00005_notification_fixes.sql` | P2, P3, P10 | New trigger fn reads Edge Function URL + shared secret from **Vault** (no hardcoded project URL, works per-environment), sends `x-push-secret` header, and swallows errors so message inserts can never fail because of push. Rewrites `get_user_rooms`: unread count excludes own messages and uses an indexed lateral count instead of joining the entire message history. |
| `supabase/functions/send-push-on-message/index.ts` | P2, P8, P12 | Rejects requests without the correct `x-push-secret` (401). Re-reads the message from DB instead of trusting the payload (spoofing impossible even if the secret leaks partially). Chunks pushes at 100/request. Parses Expo tickets and deletes `DeviceNotRegistered` tokens. |
| `src/hooks/useRealtime.ts` | P5, P6, P14 | Full rewrite. Both hooks: subscribe-status handling, auto-reconnect after `CHANNEL_ERROR`/`TIMED_OUT`, refetch-on-recovery (missed messages / unread counts). `useRealtimeRooms`: deps are `userId` string only (no more churn on room open or token refresh); `activeRoomId` read via `getState()` at event time (no stale closures); AppState listener resyncs on foreground; unknown room → `fetchRooms` fallback (first message of a new conversation shows immediately); sender name resolved via cached profile lookup for the room-list preview; `room_participants` UPDATE no longer triggers a full refetch — own `last_read` updates just clear that room's badge (cross-device read sync, kills the refetch storm). |
| `app/_layout.tsx` | P6 | `useRealtimeRooms()` mounted once in `AuthGate` — badges update on every screen, including deep-link into chat. `useNotifications` now gated on `initialized` too. |
| `src/hooks/useRooms.ts` | P6 | Removed per-screen `useRealtimeRooms()` mount (now global, prevents duplicate channels). |
| `src/hooks/useNotifications.ts` | P4 | `useLastNotificationResponse()` replaces the imperative listener: handles cold-start taps (app killed) and warm taps; navigation deferred until auth is ready; deduped per response id. |
| `src/stores/authStore.ts` | P7, P13, P15 | `onAuthStateChange` callback no longer awaits Supabase calls (deadlock pattern removed; `fetchProfile` deferred via `setTimeout`). Push registration removed from `initialize`/`signIn` — single path via `useNotifications → startPushTokenSync`. `signOut` resets `chatStore` + `roomStore` (no stale data for the next account). |
| `src/services/pushTokenService.ts` | P7, P15 | Token persisted in SecureStore → sign-out cleanup works after app restarts (no more cross-account push leakage). Synced-marker skips the delete+insert DB round-trip on every app foreground. |
| `src/services/notificationService.ts` | P11 | `device_id` is now a persisted per-install random ID instead of `Device.modelName` (two identical phone models no longer delete each other's tokens). |
| `src/stores/chatStore.ts` | P9 | `replaceOptimisticMessage` drops the temp message when realtime already delivered the real one → no duplicate ids / FlashList key collisions. |
| `src/hooks/useMessages.ts` | P6, P10 | Effect deps use `user?.id` (no re-fetch churn on token refresh); `updateLastRead` failures now caught + logged instead of unhandled rejections. |
| `src/hooks/useTypingIndicator.ts` | P6 | Deps use `userId` string — presence channel no longer resubscribes on token refresh. |
| `supabase/ANDROID_PUSH_SETUP.txt` | — | Rewritten for the new pipeline (Vault secrets, `PUSH_FUNCTION_SECRET`, google-services.json, verification SQL). |

## 2. Database Migrations Added

- **`00005_notification_fixes.sql`** — replaces the 00004 trigger function (Vault-based URL/secret, error-safe) and `get_user_rooms` (correct + fast unread). Idempotent (`CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`). Must be applied to **both** dev and prod projects.

## 3. Security Improvements

1. Edge Function requires `x-push-secret` matching the `PUSH_FUNCTION_SECRET` function secret → notification spoofing/spam blocked (P8).
2. Function re-reads the message row with the service client — forged payloads for non-existent messages are rejected with 400.
3. Push token removed on sign-out even after app restart → no cross-account notification leakage (P7).
4. Per-account Zustand state wiped on sign-out.
5. Secrets live in Supabase Vault / function secrets — nothing hardcoded in SQL or client.

## 4. Performance Improvements

1. `get_user_rooms` no longer aggregates a room's **entire** message history — lateral count bounded by `idx_messages_room_created`.
2. Refetch storm eliminated: `room_participants` UPDATE (fired on every room open/close by every member) no longer causes a full `get_user_rooms` RPC per online member — only own-row badge clearing.
3. `global:messages` channel subscribes once per session instead of on every room navigation / token refresh.
4. Push registration DB writes skipped when the user/token pair is already synced (was: 1 delete + 1 insert on **every** app foreground).
5. Push registration runs once per session (was 3–4× per login).
6. Sender-name lookups for previews cached in-memory.

## 5. Messenger Behavior — code-trace results

| # | Scenario | Result (static trace) |
|---|---|---|
| 1 | App open, inside the room | ✅ realtime insert renders via `room:{id}` channel; push banner suppressed (`handleNotification` checks `activeRoomId` at delivery time); no unread increment |
| 2 | App open, another screen/room | ✅ badge increments (global channel, live `getState()` check) + FCM foreground banner shows |
| 3 | App background | ✅ FCM system notification (after manual FCM setup + rebuild) |
| 4 | App killed → tap notification | ✅ `useLastNotificationResponse` + auth-ready gating routes to `/chat/{roomId}` |
| 5 | Multiple devices | ✅ install-UUID device ids (no token clobbering); unread excludes own messages; own `last_read` UPDATE clears the badge on the other device |
| 6 | Offline → reconnect | ✅ status-callback reconnect + `fetchRooms`/`fetchMessages` resync; AppState foreground resync |

Post-implementation checklist: single global channel mount (verified by grep — `useRealtimeRooms` only in `_layout.tsx`), no duplicate registrations (`registerPushNotificationsForUser` only in `startPushTokenSync` + manual Settings button), all effects clean up channels/timers/subscriptions, optimistic dedupe in both directions, no `user`-object deps left in realtime effects.

## 6. Remaining Risks

- `tabBarBadge` total-unread on the tab bar and app-icon badge count are still not implemented (audit UX-gap item, not in P1–P15 scope).
- iOS and web push remain unsupported by design.
- Tapping a notification for the room you are already viewing pushes the same route again (cosmetic).
- The Supabase MCP in this workspace still points to an unrelated project — deployed state must be verified with the SQL in `ANDROID_PUSH_SETUP.txt` §7 after setup.
- On-device scenarios (1–6 above) are code-verified only; they need a fresh EAS build to be exercised for real.

## 7. Manual Configuration Required (cannot be automated from here)

Run per project (dev `xoxnjqgumfhzwturtfhz`, prod `elevsuvbbittizjxrfll`) — full commands in `supabase/ANDROID_PUSH_SETUP.txt`:

1. **Firebase**: create project → add Android app `com.haruthao.tlchatting` → download `google-services.json` → place at **repo root**.
2. **EAS**: `eas credentials --platform android` → upload FCM V1 service-account key.
3. **Migrations**: apply `00005` (`supabase db push` or SQL Editor).
4. **Vault**: `SELECT vault.create_secret('https://<ref>.supabase.co/functions/v1/send-push-on-message', 'push_function_url');` and `SELECT vault.create_secret('<openssl rand -hex 32>', 'push_function_secret');`
5. **Function**: `supabase secrets set PUSH_FUNCTION_SECRET=<same secret>` → `supabase functions deploy send-push-on-message --no-verify-jwt`.
6. **Rebuild**: `npm run build:android:preview` (native config changed — old APKs cannot receive push).
7. **Verify**: SQL checks in setup doc §7 (`pg_trigger`, `net._http_response`, `push_tokens`).

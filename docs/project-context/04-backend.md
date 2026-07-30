# 04 — Backend Architecture

## Overview

The backend is **entirely Supabase** (PostgreSQL + Auth + Realtime + Storage + one Edge Function). There is no custom application server, no API routes, and no middleware layer in the traditional sense. All privileged logic lives inside the database as `SECURITY DEFINER` functions guarded by RLS. Two Supabase projects exist: dev (`xoxnjqgumfhzwturtfhz`, used by EAS `development`/`preview` profiles) and production (`elevsuvbbittizjxrfll`, used by the `production` profile and — flagged as a defect — also by `.env.development`).

```
Client (Expo app: Android / Web / iOS)
  │
  ├── supabase-js (anon key, RLS-enforced)
  │     ├── PostgREST      → tables + SECURITY DEFINER RPCs
  │     ├── Realtime WS    → postgres_changes / Presence / Broadcast
  │     ├── Storage        → avatars, chat-media (public buckets)
  │     └── GoTrue Auth    → email/password sessions
  │
  └── (server-side only)
        messages INSERT ──trigger──> pg_net POST ──> Edge Function ──> Expo Push API ──> FCM
        pg_cron (every minute) ──> process_scheduled_messages() ──> messages INSERT (fires same trigger)
```

## Supabase Client

`src/lib/supabase.ts`: typed client from `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Auth storage is an `expo-secure-store` adapter on native, default browser storage on web; `autoRefreshToken` and `persistSession` true; `detectSessionInUrl` web-only (needed for the password-reset deep link). No custom realtime parameters.

## Authentication

- **Provider**: Supabase GoTrue, email + password only. No OAuth providers found in repository.
- **Sign-up** (`src/stores/authStore.ts`): email/password with `username`/`display_name` in user metadata. A DB trigger `on_auth_user_created` → `handle_new_user()` auto-creates the `profiles` row and provisions `privacy_settings` defaults.
- **Sign-in**: accepts email *or* username. Usernames are resolved to email via the `get_email_by_username` RPC (SECURITY DEFINER, granted to `anon` — flagged as an enumeration surface in `PRODUCTION_CHECKLIST.md`), then `signInWithPassword`.
- **Session**: persisted in SecureStore (native) / browser storage (web); `onAuthStateChange` subscription defers profile fetch via `setTimeout` to avoid the documented supabase-js deadlock.
- **Password reset**: `resetPasswordForEmail` with a deep-link redirect to the `reset-password` screen; `updatePassword` calls `updateUser` then force-signs-out.
- **Sign-out**: removes the device push token first, signs out, resets chat/room/privacy stores.
- **Authorization**: 100% RLS. The client only ever holds the anon key; every table has RLS enabled; helper functions (`get_my_room_ids`, `is_room_admin`, `is_room_creator`, `shares_room_with`, `is_blocked_with`, `is_dm_blocked`…) break RLS recursion and encode the access rules.

## Database

PostgreSQL defined by 16 sequential migrations (`supabase/migrations/00001…00016`). 15 application tables — see `09-database.md` for the full inventory. Key architectural choices:

- All multi-row read paths are **RPCs** (`get_user_rooms`, `search_messages`, `get_peer_profile`, `search_profiles`…) rather than client-composed joins, so visibility/privacy rules are enforced in one place.
- Writes that need cross-row privileges (pin someone else's message, mark room read with receipt mirroring, submit a report) also go through SECURITY DEFINER RPCs (`set_message_pin`, `mark_room_read`, `submit_report`).
- Data integrity via triggers: recalled messages become immutable (`messages_block_update_after_delete`); call rows log a system message on their first terminal transition (`trigger_log_call_message`).
- Extensions in use: `pg_net` (HTTP from triggers), `pg_cron` (scheduled delivery), `pg_trgm` (substring search), Vault (secrets for the push webhook).

## Realtime

Supabase Realtime is used in three modes:

1. **postgres_changes** — publication includes `messages`, `room_participants`, `message_reactions`, `poll_votes`, `room_reads`, `calls`. Client channels:
   - `room:${roomId}` — per-room: message INSERT/UPDATE/DELETE, reactions, poll votes, participant watermark updates (all filtered by `room_id`)
   - `global:messages` — **unfiltered** message INSERTs across all rooms (room-list previews and unread counts) plus participant and `room_reads` events; identified as the main scaling ceiling in `PRODUCTION_CHECKLIST.md`
   - `calls:global` — call INSERT (incoming ring) / UPDATE (lifecycle), RLS-scoped
2. **Presence** — `typing:${roomId}` channels for typing indicators (key = userId).
3. **Broadcast** — per-call signaling channel (call id as name) carrying `ready/offer/answer/ice/hangup` so SDP/ICE never touch the database.

Realtime channels are public (no private-channel authorization) — an accepted residual risk in `docs/SECURITY_REVIEW.md` §5.

## Storage

Two **public** buckets (created in migration 00007):

| Bucket | Path convention | Write policy |
|--------|----------------|--------------|
| `avatars` | `{userId}/{timestamp}.jpg` | insert/update/delete only inside your own user folder |
| `chat-media` | `{roomId}/{timestamp}.jpg` | insert (and, since 00015, update/delete) only by participants of the room folder |

Public read on both is a documented launch blocker (anyone with a URL can read chat images). Uploads convert local URIs to ArrayBuffers (`fetch()` → `arrayBuffer()`) and store the resulting public URL on the row. Clients best-effort delete storage objects when recalling media messages or replacing avatars.

## Edge Functions

Exactly one: **`send-push-on-message`** (Deno, deployed with JWT verification off).

- **Trigger**: AFTER INSERT trigger on `messages` → `notify_push_on_new_message()` reads the function URL + shared secret from **Vault** and POSTs the row via `pg_net`; failures never block the insert; skips silently if unconfigured.
- **Auth**: validates the `x-push-secret` header against `PUSH_FUNCTION_SECRET` — only the DB trigger can call it.
- **Flow**: re-reads the message with the service-role key (never trusts the payload) → resolves sender name → lists recipients (participants minus sender) → loads each recipient's `preferred_language` for localized copy (en/vi) → fetches push tokens **filtered to `platform = 'android'`** → dedupes → POSTs to the Expo Push API in chunks of 100 → deletes tokens whose tickets return `DeviceNotRegistered`.
- **Payload**: title = sender name, body = content or localized media preview, `data: { roomId, type: "message" }` for deep linking, Android channel `messages`, high priority.

## RPC (complete client-side list)

| RPC | Called from | Purpose |
|-----|-------------|---------|
| `get_user_rooms` | `roomService` | Room list with last message, unread count, DM peer name/avatar, bookmark ordering |
| `mark_room_read` | `roomService` | Update private `room_reads` watermark; mirror to public `room_participants.last_read_at` only if receipts enabled |
| `get_email_by_username` | `profileService` | Username → email for login |
| `is_username_available` | `profileService` | Registration check |
| `search_profiles` | `profileService` | Block- and visibility-aware people search (limit 20) |
| `get_peer_profile` | `privacyService` | Single gateway for peer presence/phone/avatar (75s online window) |
| `get_blocked_profiles` | `privacyService` | Blocked list |
| `submit_report` | `privacyService` | Report user with message snapshot |
| `set_message_pin` | `messageService` | Any participant pins/unpins despite sender-only UPDATE RLS |
| `search_messages` | `searchService` | Trigram search across message/image/file/link lanes, cursor-paginated (limit clamped 1–50) |

## API Routes

**None.** The web build is a static Metro export (`output: "static"` in `app.json`); there are no server routes, no Next.js, no serverless functions besides the Supabase edge function. Vercel serves static files with an SPA rewrite (`vercel.json`).

## Middleware

**No application middleware exists.** Cross-cutting concerns are handled by:
- RLS policies + SECURITY DEFINER functions (authorization)
- The `AuthGate` / `AppLockGate` components client-side (routing guards)
- The `x-push-secret` header check inside the edge function (webhook auth)

## Background Jobs

One: pg_cron job **`process-scheduled-messages`**, every minute, calling `process_scheduled_messages()` (SECURITY DEFINER, `FOR UPDATE SKIP LOCKED`, batch of 100). It inserts due `scheduled_messages` rows into `messages` (which fires the push trigger) or marks them `failed` if the sender left the room. The client only creates/lists/cancels pending rows; delivery is entirely server-side. Granularity is 1 minute (noted limitation in `docs/reports/FEATURE_ANALYSIS.md`).

## Request Flow Examples

**Send a message**: client `messageService.sendMessage` → PostgREST INSERT into `messages` (RLS checks: sender is participant, DM not blocked) → row replicated to `room:${roomId}` and `global:messages` channels for all subscribed clients → AFTER INSERT trigger POSTs to the edge function via pg_net → Expo Push API → FCM → recipient devices.

**Open the app**: `authStore.initialize` reads the persisted session → `get_user_rooms` RPC builds the room list server-side → `global:messages` channel keeps it live.

**Scheduled send**: client inserts into `scheduled_messages` → pg_cron (≤1 min later) moves it into `messages` → same realtime + push fan-out as a normal send.

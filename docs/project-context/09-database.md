# 09 — Database

> Final schema state after all 16 migrations (`supabase/migrations/00001…00016`). Summarized — no SQL dump.

## Main Tables (15)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `profiles` | User identity (auto-created on signup) | id (FK auth.users), unique `username`, `display_name`, `avatar_url`, `preferred_language`; legacy `status`/`last_seen_at` (dead by design after migration 00010) |
| `rooms` | Conversations | `type` (direct/group), `name`, `avatar_url`, `created_by` |
| `room_participants` | Membership | `role` (admin/member), `joined_at`, `last_read_at` (public receipt mirror), `bookmarked_at` (conversation pin); unique (room, user) |
| `messages` | Chat messages | `content`, `type` (text/image/video/file/system/poll/call), `media_url`, `attachments` JSONB (albums), `metadata` JSONB (polls/mentions/calls), `reply_to` (self-FK), `thread_id` (self-FK, flat threads), `pinned_at/by`, `deleted_at/by` (soft recall), `is_edited`, generated `has_link` |
| `push_tokens` | Expo push tokens | user_id, token, `platform` (android/ios/web), device_id; unique (user, token) |
| `saved_messages` | Private bookmarks | unique (user, message) |
| `scheduled_messages` | Send-later outbox | content, reply_to, `scheduled_at`, `status` (pending/sent/canceled/failed), sent_message_id |
| `message_reactions` | Emoji reactions | unique (message, user, emoji); `room_id` denormalized for realtime filtering |
| `poll_votes` | Poll votes | unique (message, user) = single choice |
| `privacy_settings` | Per-user privacy toggles | last-seen/online/avatar/phone visibility, read_receipts_enabled, typing_indicators_enabled, phone_number |
| `user_presence` | Online heartbeat | last_active_at (75 s online window, read via RPC only) |
| `room_reads` | Private read watermark | PK (room, user), last_read_at |
| `user_blocks` | Block edges | PK (blocker, blocked) |
| `user_reports` | Moderation queue | reason, message_snapshot, status (open/reviewed/dismissed) |
| `calls` | 1:1 call lifecycle/signaling | room_id, caller_id, callee_id, `type` (audio/video), `status` (ringing/answered/declined/missed/ended), answered_at, ended_at, duration_seconds |

## Relationships

- `profiles.id` → `auth.users.id` (1:1, trigger-created).
- `rooms` 1—N `room_participants` N—1 `profiles`; `rooms.created_by` → profiles.
- `messages` N—1 `rooms` / `profiles(sender)`; self-FKs `reply_to` and `thread_id` (ON DELETE SET NULL).
- `message_reactions`, `poll_votes`, `saved_messages` → `messages` + user.
- `scheduled_messages` → room + sender + optional `reply_to` + `sent_message_id` → messages.
- `room_reads` → (room, user); `user_blocks`/`user_reports` → profile pairs; `calls` → room + caller + callee.

## Indexes (highlights)

- `messages`: (room_id, created_at DESC) — the pagination hot path; partial indexes for pins, media lane, links lane, thread; **GIN trigram** on live content (search); partial FK indexes covering hard-delete cascade paths (reply_to, saved/scheduled refs) added in 00016.
- `profiles`: unique username, functional `lower(username)` (login), trigram GINs on username and display_name (people search).
- `room_participants`: by room and by user. `push_tokens`: by user. `scheduled_messages`: partial on pending. `calls`: (room_id, created_at DESC) + partial ringing-by-callee.

## Constraints (highlights)

- CHECK constraints: `rooms.type`, `room_participants.role`, `messages.type`, `push_tokens.platform`, `scheduled_messages.status` + `scheduled_at > created_at`, `calls.type/status`, `user_reports.reason/status`, privacy visibility enums.
- Uniques: username; (room, user) participants; (user, token); (user, message) saved; (message, user, emoji) reactions; (message, user) poll votes.
- Trigger-enforced: recalled messages immutable (`messages_block_update_after_delete`); one call-log message per terminal call transition.

## RLS

Enabled on **every** table. Summary of intent:

| Table | Read | Write |
|-------|------|-------|
| profiles | self or room-mate (authenticated only) | self only |
| rooms | participants + creator | creator insert; group-admin update (00014) |
| room_participants | co-participants (via `get_my_room_ids`) | self/admin/creator insert with DM-block guard; owner update |
| messages | room participants | sender insert (block-aware); sender update/delete; immutable after recall |
| push_tokens, saved_messages, scheduled_messages, privacy_settings, user_presence, room_reads, user_blocks | owner only | owner only (saved insert also checks room membership; scheduled delete only while pending) |
| user_reports | reporter select only | **no INSERT policy** — writes only via `submit_report` RPC |
| calls | caller/callee only | caller insert (direct room, both members, no block); either side updates lifecycle |
| storage.objects | public read on both buckets | avatars: own folder; chat-media: room participants (insert/update/delete) |

Recursion is broken with SECURITY DEFINER helpers (`get_my_room_ids`, `is_room_admin`, `is_room_creator`, `shares_room_with`, `is_blocked_with`, `is_dm_blocked`, `is_dm_peer_blocked`).

## Realtime-Enabled Tables

`supabase_realtime` publication contains: **messages, room_participants, message_reactions, poll_votes, room_reads, calls**. `message_reactions` and `poll_votes` use `REPLICA IDENTITY FULL`. Deliberately excluded: saved_messages, scheduled_messages, profiles, privacy tables (per `docs/DATABASE_CHANGES.md`).

## Functions / Triggers / Extensions

- Triggers: `on_auth_user_created` (profile + privacy defaults), `trigger_push_on_message_insert` (pg_net → edge function, Vault-configured), `messages_block_update_after_delete`, `trigger_log_call_message`.
- RPCs: see `04-backend.md` for the client-facing list; server-only: `process_scheduled_messages` (pg_cron every minute).
- Extensions: `pg_net`, `pg_cron`, `pg_trgm`, Vault.

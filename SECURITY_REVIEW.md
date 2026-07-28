# Talo — Privacy Controls Security Review

> Pre-implementation review for the privacy-controls feature set.
> Scope: Last Seen / Online Status visibility, Read Receipt settings, Typing
> Indicator settings, Profile Photo privacy, Phone Number privacy, Block Users,
> Report Users, Local App Lock (PIN / biometrics).
> Author role: Security Engineering + Product Design. Date: 2026-07-28.

---

## 1. Methodology

- Full read of `supabase/migrations/00001–00009` (schema, RLS, RPCs, triggers,
  realtime publication).
- Trace of every client data path that touches profile, presence, receipt and
  typing data (`src/services/*`, `src/hooks/useRealtime.ts`,
  `useTypingIndicator.ts`, `useMessages.ts`, `src/lib/receipts.ts`).
- Review against Supabase security guidance: RLS-first authorization,
  `SECURITY DEFINER SET search_path = ''` for privileged functions, anon-key
  only on client, no service-role exposure, secrets in Vault.

Guiding principle: **a privacy setting only counts as implemented when the
server enforces it.** Client-side gating is acceptable only for data that the
user's own device produces (e.g. not broadcasting a typing event); it is never
acceptable for data another client could query.

---

## 2. Current posture — findings

| ID | Severity | Finding |
|----|----------|---------|
| F-1 | **High** | `profiles_select` is `USING (true)` with no `TO` clause: **every profile row (username, display name, avatar, status, last_seen_at) is readable by `anon` and any authenticated user.** Full user enumeration is possible with the public anon key. |
| F-2 | **High** | No blocking primitive exists. Any user can open a DM with any other user (`roomService.createDirectRoom`) and message them; there is no way to stop harassment. |
| F-3 | **Medium** | `room_participants.last_read_at` is in the `supabase_realtime` publication and readable by all room members — read receipts are always-on with no opt-out, and the raw watermark is pushed to every member's device. |
| F-4 | **Medium** | No reporting mechanism. Abuse cannot be escalated; recalled (soft-deleted) messages destroy evidence. |
| F-5 | **Medium** | `avatars` and `chat-media` storage buckets are `public = true`: any object URL is world-readable without auth. Acceptable for chat media today, but incompatible with strict photo privacy. |
| F-6 | **Medium** | No app lock. A device left unlocked exposes all conversations; the Supabase session is in SecureStore but the UI has no local gate. |
| F-7 | **Low** | `get_email_by_username` is executable by `anon` → account-existence oracle by username. Required for the username-login feature; mitigate with Auth rate limiting / CAPTCHA (project setting, not schema). |
| F-8 | **Low** | Realtime channels `typing:{roomId}` and `room:{roomId}` are *public* channels: any authenticated user who guesses a room UUID can join and observe presence payloads (display names + typing flags). `postgres_changes` payloads are RLS-filtered, so message data is safe; only the ephemeral presence metadata leaks. |
| F-9 | **Info** | `profiles.status` / `profiles.last_seen_at` exist but are never written — presence is currently dead schema. They live in a table other users can read, so they must **not** be revived in place (see F-1). |
| F-10 | **Info** | There is no phone number field today. It must be introduced in a store that is *not* peer-readable by default (profiles is embedded via `profiles(*)` in many queries). |

### Threat model (abridged)

| Actor | Capability | Must be prevented from |
|-------|-----------|------------------------|
| Anonymous holder of anon key | REST/RPC calls as `anon` | Enumerating profiles, reading presence, reading any private data |
| Authenticated stranger | Any query as `authenticated` | Reading presence/phone/avatar of users who restricted them; messaging users who blocked them |
| Room member (contact) | RLS-visible room data | Reading watermarks of users who disabled receipts; reading phone numbers not shared with them |
| Modified client | Arbitrary API calls with a valid JWT | Bypassing any of the above (⇒ all enforcement in RLS / SECURITY DEFINER RPCs) |
| Person with physical device access | Opens the app | Reading chats when App Lock is enabled |

---

## 3. Design

### 3.1 Data model (migration `00010_privacy_controls.sql`)

| Object | Purpose | RLS |
|--------|---------|-----|
| `privacy_settings` | 1 row per user: `last_seen_visibility`, `online_visibility` (`everyone/contacts/nobody`), `read_receipts_enabled`, `typing_indicators_enabled`, `avatar_visibility` (`everyone/contacts`), `phone_visibility` (`contacts/nobody`), `phone_number` | Owner-only (`user_id = auth.uid()`) for SELECT/INSERT/UPDATE. Peers never read this table directly. |
| `user_presence` | Heartbeat store: `last_active_at` per user | Owner-only writes/reads. Peers read presence **only** through `get_peer_profile` RPC. |
| `room_reads` | **Private** read watermark per (room, user) | Owner-only. Powers the user's own unread counts even when receipts are off. |
| `user_blocks` | `(blocker_id, blocked_id)` | Blocker manages own rows; existence between two users checked via `SECURITY DEFINER` helper. |
| `user_reports` | Report queue with a server-side **content snapshot** of the reported message (survives recall) | Reporter can INSERT (via RPC) and SELECT own reports; no client UPDATE/DELETE — triage is service-role/dashboard only. |

"Contacts" is defined as *shares at least one room with me* (the app has no
address book), evaluated by the existing `get_my_room_ids()` pattern.

### 3.2 Enforcement points per feature

| Feature | Enforcement (server) | Client behavior |
|---------|---------------------|-----------------|
| **Last Seen** | `get_peer_profile(p_user_id)` RPC (`SECURITY DEFINER`) returns `last_seen_at` only if target's `last_seen_visibility` admits the caller and no block exists either way. No direct table access for peers. | DM header polls the RPC while the chat is open; renders "Hoạt động X trước" or nothing. |
| **Online Status** | Same RPC computes `is_online = last_active_at > now() - 75s`, gated by `online_visibility` + blocks. | Heartbeat hook upserts `user_presence` every 45 s while foregrounded (own-row RLS). |
| **Read Receipts** | `mark_room_read(p_room_id)` RPC always updates private `room_reads`; it mirrors to the public `room_participants.last_read_at` **only when `read_receipts_enabled`**. Peers therefore never receive a realtime watermark from an opted-out user. `get_user_rooms` unread counts switch to `COALESCE(room_reads, room_participants)` so the user's own badges keep working. | `roomService.updateLastRead` → RPC. Receipt sheet unchanged (data simply absent for opted-out users). |
| **Typing Indicator** | Ephemeral channel presence — produced only by the owner's device; when disabled the client never broadcasts. (Residual: F-8, see §5.) | `useTypingIndicator.startTyping` no-ops when the setting is off. Incoming indicators still render (senders opted in). |
| **Profile Photo** | `profiles_select` tightened to *self OR shares-a-room* (`TO authenticated`); public search moves to `search_profiles(p_query)` RPC which returns `avatar_url = NULL` when `avatar_visibility = 'contacts'` and excludes blocked relationships. | Search results / contact sheet fall back to initials avatar. |
| **Phone Number** | Stored in `privacy_settings` (owner-only table), never in `profiles`. Exposed solely through `get_peer_profile`, gated by `phone_visibility` (default `nobody`). | Editable in Privacy settings; shown in contact info sheet when permitted. |
| **Block Users** | (a) `messages_insert` policy gains `AND NOT is_dm_blocked(room_id)` — blocked DMs reject sends in **both** directions at the database. (b) `participants_insert` gains `AND NOT is_blocked_between(auth.uid(), user_id)` — cannot create a DM with someone who blocked you. (c) `search_profiles`, `get_peer_profile` filter blocks. Group rooms are intentionally unaffected (industry standard). | Blocked DM shows a banner + disabled composer + "Bỏ chặn"; blocked-list management screen; block action in the contact sheet. |
| **Report Users** | `submit_report(...)` RPC validates the reporter can actually see the reported message, snapshots its content server-side, inserts with `reporter_id = auth.uid()`. | "Báo cáo" in message long-press (others' messages) and in the contact sheet; reason picker + optional note. |
| **App Lock** | Local-only by design (no server involvement). PIN stored as `SHA-256(salt‖pin)` with a random 128-bit salt in **expo-secure-store** (hardware-backed keystore). Biometric unlock via **expo-local-authentication** with PIN fallback. 5 failed attempts → 30 s cooldown (persisted). Locks on cold start and on return from background. Native only (SecureStore has no web backend); the setting is hidden on web. | `AppLockGate` overlay above `AuthGate`. Disabling the lock or changing PIN requires the current PIN. Raw PIN never persisted or logged. |

### 3.3 RLS policy changes (summary)

```
profiles_select      : USING(true)  →  TO authenticated USING (id = auth.uid()
                                          OR id IN (participants of my rooms))
messages_insert      : + AND NOT is_dm_blocked(room_id)
participants_insert  : + AND NOT is_blocked_between(auth.uid(), user_id)
NEW privacy_settings : owner-only select/insert/update
NEW user_presence    : owner-only select/insert/update
NEW room_reads       : owner-only select/insert/update
NEW user_blocks      : blocker-only select/insert/delete
NEW user_reports     : reporter insert (via RPC) + select own; no update/delete
```

Registration/search flows that relied on the open `profiles` table move to
narrow `SECURITY DEFINER` RPCs (`is_username_available`, `search_profiles`,
`get_blocked_profiles`), each with `SET search_path = ''`, explicit
`REVOKE ... FROM PUBLIC`, and grants only to the roles that need them.
All helpers take no caller-supplied identity — they resolve the caller from
`auth.uid()` exclusively.

### 3.4 Supabase Auth best-practice checklist applied

- Client keeps using only `EXPO_PUBLIC_SUPABASE_ANON_KEY`; nothing in this
  change requires or introduces the service-role key.
- Every new privileged function: `SECURITY DEFINER SET search_path = ''`,
  `REVOKE ALL FROM PUBLIC`, explicit grants, identity from `auth.uid()` only.
- All new tables ship with RLS enabled in the same migration that creates them.
- No new table is added to the realtime publication; receipt propagation
  reuses the already-published `room_participants` and only when opted in.
- Session storage remains SecureStore-backed; App Lock secrets live beside it
  in SecureStore, never in AsyncStorage.

---

## 4. Consistency matrix (definition of done)

| Setting | Surface that must respect it |
|---------|------------------------------|
| Last seen | DM chat header subtitle, contact info sheet |
| Online | DM chat header ("Đang hoạt động"), contact info sheet |
| Read receipts off | Peer's receipt sheet shows nothing new; own unread badges still correct; no realtime watermark leaves the server |
| Typing off | No presence payload leaves the device |
| Avatar = contacts | Search results and contact sheet for strangers show initials |
| Phone = nobody/contacts | Contact sheet hides / shows accordingly; never in any other query |
| Block | Send blocked both ways (DB error), no new DM creatable, hidden from each other's search, presence/phone mutually hidden, composer replaced by unblock banner |
| Report | Works on any visible message/user; snapshot survives recall |
| App lock | Cold start + background return locked; PIN change/disable require current PIN; biometrics optional |

---

## 5. Residual risks & follow-ups (accepted, documented)

1. **Public storage buckets (F-5).** A leaked historical avatar URL remains
   fetchable even after tightening `avatar_visibility` — object URLs bypass
   RLS in public buckets. Follow-up: migrate `avatars`/`chat-media` to private
   buckets + signed URLs (breaking change for stored `avatar_url`s; out of
   scope here). Data-layer enforcement (NULLing `avatar_url` for
   non-permitted viewers) is implemented now.
2. **Public realtime channels (F-8).** Typing/room channels should become
   `private: true` with realtime authorization policies. Payloads today carry
   only display names; scheduled as a follow-up hardening.
3. **Username→email oracle (F-7).** Keep the login feature; enable Auth
   CAPTCHA / rate limits in the Supabase dashboard (operational task).
4. **Receipt reciprocity** (WhatsApp-style "turn yours off, lose others'") is
   not implemented: receipt data is fanned out via realtime rows and cannot be
   filtered per-viewer without a per-viewer delivery channel. Product accepts
   non-reciprocal semantics.
5. **App Lock is a UI gate, not encryption.** Data at rest (SQLite caches,
   OS-level) is protected by the platform, not by the PIN. This matches the
   threat model (casual physical access), and is stated in the setting's copy.

---

## 6. Implementation order

1. Migration `00010_privacy_controls.sql` (tables → helpers → RPCs → policy
   swaps, in dependency order; additive and idempotent where possible).
2. Regenerate `src/types/database.ts`; extend `src/types/index.ts` aliases.
3. `privacyService` + `privacyStore`; swap `profileService.searchUsers`,
   `isUsernameTaken`, `roomService.updateLastRead` to the new RPCs.
4. Presence heartbeat, DM header presence, receipt/typing gating.
5. Block/report UI (contact info sheet, message actions, blocked-users screen).
6. Privacy settings screen; App Lock (screens + gate + SecureStore/biometrics).
7. i18n (vi primary, en secondary) and full typecheck.

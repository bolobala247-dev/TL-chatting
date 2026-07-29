# Talo — Core Messaging Features: Analysis

> Product analysis for: Pinned Messages, Saved Messages, Shared Media, Edit Message,
> Delete for Everyone, Undo Send, Scheduled Messages.
> Companion docs: `DATABASE_CHANGES.md` (schema), `UX_FLOW.md` (flows & UI).

## 1. Current State Audit

| Area | State |
|------|-------|
| Schema | 4 core tables (`profiles`, `rooms`, `room_participants`, `messages`) + `push_tokens`. `messages` already has `reply_to`, `is_edited`, `type IN (text, image, file, system)` |
| Edit | ✅ Already implemented (`messageService.updateMessage` + edit dialog) — sender-only via RLS |
| Delete | ⚠️ Hard `DELETE` (row removed). No "recalled message" placeholder; replies lose context via `ON DELETE SET NULL` |
| Pin / Save / Media / Undo / Schedule | ❌ Not implemented |
| Realtime | `room:{roomId}` channel handles INSERT / UPDATE / DELETE on `messages` — UPDATE events already propagate to `chatStore.updateMessage` |
| Pagination | Cursor-based on `created_at`, 20/page, FlashList v2 bottom-up rendering |
| Push | DB trigger on `messages` INSERT → Edge Function (unaffected by these features except scheduled sends, which reuse it for free) |

## 2. Feature Decisions

### 2.1 Pinned Messages
- **Model:** columns on `messages` (`pinned_at`, `pinned_by`) — NOT a separate table.
  Rationale: pin state rides the existing realtime `UPDATE` events and the existing
  `chatStore.updateMessage` path with zero new channels; a join table would need its own
  publication, policies, and client sync.
- **Who can pin:** any room participant (Telegram/WhatsApp behavior). Existing RLS only
  lets senders update their messages, so pinning goes through a `SECURITY DEFINER` RPC
  `set_message_pin` that validates participation.
- **UI:** pinned banner at top of chat (latest pin) → tap opens full pinned list; pin icon in bubble meta.

### 2.2 Saved Messages (Favorite)
- **Model:** new `saved_messages` join table (`user_id`, `message_id`). Strictly personal —
  the other side never sees it, so it must NOT live on `messages`.
- **Scope:** global "Tin nhắn đã lưu" screen (entry in Settings) across all rooms;
  save/unsave from the message action sheet.
- **No realtime:** single-user data; fetch on demand.

### 2.3 Shared Media (Images, Videos, Files, Links)
- **Model:** no new table — media *is* messages. Three query lanes over `messages`:
  - Media: `type IN ('image','video')` (CHECK constraint extended with `'video'` for forward-compat)
  - Files: `type = 'file'`
  - Links: new **stored generated column** `has_link` (regex on `content`) so link queries
    are index-backed instead of `ILIKE '%http%'` table scans.
- **Performance:** partial indexes per lane (`room_id, created_at DESC`) — a 500k-message
  room with 2k photos only touches the 2k-row index.
- **UI:** dedicated screen from the chat header, segmented tabs, 3-column grid for media,
  rows for files/links, cursor pagination.

### 2.4 Edit Message (existing — hardened)
- Kept as-is functionally. Hardening added at DB level: a trigger rejects any UPDATE on an
  already-deleted message, so a stale client can't "edit" a recalled message.

### 2.5 Delete for Everyone
- **Model:** soft delete (`deleted_at`, `deleted_by`) instead of hard `DELETE`.
  Rationale: everyone must see "Tin nhắn đã bị thu hồi" in place; replies keep pointing at
  the tombstone; hard delete would silently drop rows for offline clients.
- Content and `media_url` are **nulled** on recall (privacy — data leaves the DB, not just the UI).
  Pin state is cleared at the same time.
- Sender-only, via existing `messages_update` RLS policy (no new policy needed).
- Old hard delete stays in the service exclusively for **Undo Send** (below).
- `get_user_rooms` updated so room previews don't leak recalled content.

### 2.6 Undo Send (5–10 s)
- **Model:** client-side window of **8 s** after a successful send; pressing "Hoàn tác" issues
  the existing hard `DELETE` (row is seconds old; realtime DELETE removes it everywhere).
  No schema change, no delayed sending — messages stay instant.
- Delayed-send was rejected: it breaks realtime expectations and typing-indicator semantics.

### 2.7 Scheduled Messages
- **Model:** new `scheduled_messages` outbox table + `pg_cron` job (every minute) calling a
  `SECURITY DEFINER` function that inserts due rows into `messages` and marks them `sent`.
  Push notifications fire automatically via the existing INSERT trigger.
- **Why not client timers / Edge Function cron:** device may be offline at fire time; pg_cron
  runs inside the DB with no extra infra and transactional consistency.
- **Guard:** if the sender left the room before fire time, the row is marked `failed`, not sent.
- **UI:** long-press the send button → time presets; pending chip above the composer; list sheet with cancel.

## 3. Requirement Compliance

| Requirement | How it's met |
|---|---|
| Reuse existing tables | Pin / delete / media / links live on `messages`; only 2 genuinely-new domains get tables |
| Supabase best practices | RLS on every new table, `SECURITY DEFINER` + `search_path` pinning on functions, partial indexes, generated column, pg_cron |
| RLS correctness | Per-policy analysis in `DATABASE_CHANGES.md` §4 |
| Backward compatibility | Only additive columns (all nullable), CHECK widened not narrowed, `get_user_rooms` signature unchanged, existing queries (`select *`) keep working |
| Preserve functionality | Send/reply/edit/image/typing/push flows untouched; delete UX upgraded but same entry point |
| Design system | Reuses `Sheet`, `Dialog`, `ConfirmDialog`, `Icon`, tokens (`surface`, `fg-*`, `divider`, `danger`) — no new colors |
| Light/Dark | All new UI uses semantic NativeWind tokens only |
| Responsive | Grids via FlashList `numColumns`, max-width bubbles kept, banners flex |
| Large conversations | Partial indexes, cursor pagination on every new list, FlashList everywhere, no N+1 (FK-hinted embeds) |

## 4. Out of Scope (deliberate)

- Video **capture/upload** UI (schema + rendering support only; picker still image-only)
- "Delete for me" (per-user hide) — separate feature, needs a `hidden_messages` table
- Edit history / audit log
- Link previews (OG scraping) — Links tab lists link messages; preview needs a fetch proxy
- Scroll-to-message from pinned banner (FlashList + cursor pagination makes arbitrary jump unreliable; pinned list sheet shows full content instead)

## 5. Rollout / Risk

- Single migration `00008_message_features.sql`, additive-only → zero-downtime.
- Old app versions keep working against the new schema (they just hard-delete instead of recall, and ignore new columns).
- pg_cron granularity is 1 minute → a scheduled message fires ≤ 59 s after its time. Acceptable; documented in UX copy ("sẽ được gửi lúc ~").

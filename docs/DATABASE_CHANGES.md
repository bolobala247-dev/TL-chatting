# Talo — Database Changes: Core Messaging Features

> Migration: `supabase/migrations/00008_message_features.sql` (single, additive, zero-downtime).
> Project: `elevsuvbbittizjxrfll`. After applying, regenerate types:
> `npx supabase gen types typescript --project-id elevsuvbbittizjxrfll > src/types/database.ts`

## 1. Changes to Existing Tables

### 1.1 `messages` — new columns (all nullable ⇒ backward compatible)

| Column | Type | Purpose |
|---|---|---|
| `pinned_at` | `TIMESTAMPTZ` | Pin timestamp; `NULL` = not pinned |
| `pinned_by` | `UUID → profiles(id) ON DELETE SET NULL` | Who pinned |
| `deleted_at` | `TIMESTAMPTZ` | Recall ("delete for everyone") timestamp; `NULL` = live |
| `deleted_by` | `UUID → profiles(id) ON DELETE SET NULL` | Who recalled |
| `has_link` | `BOOLEAN GENERATED ALWAYS AS (content ~* URL regex) STORED` | Index-backed link lane for Shared Media |

### 1.2 `messages.type` CHECK widened

`('text','image','file','system')` → `('text','image','video','file','system')`.
Widening only — every existing row still passes.

### 1.3 New indexes (all partial — near-zero write cost on non-matching rows)

```sql
idx_messages_room_pinned  ON messages(room_id, pinned_at DESC)  WHERE pinned_at IS NOT NULL
idx_messages_room_media   ON messages(room_id, created_at DESC) WHERE type IN ('image','video','file') AND deleted_at IS NULL
idx_messages_room_links   ON messages(room_id, created_at DESC) WHERE has_link AND deleted_at IS NULL
```

### 1.4 Integrity trigger

`messages_block_update_after_delete` (BEFORE UPDATE): once `deleted_at` is set, every further
UPDATE is rejected — protects recalled messages from stale-client edits/re-pins.

## 2. New Tables

### 2.1 `saved_messages` (Favorites — per user, private)

```sql
CREATE TABLE public.saved_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, message_id)
);
-- idx: (user_id, created_at DESC) for the saved-messages screen
```

`ON DELETE CASCADE` from `messages`: if a saved message is hard-deleted (undo send), the
bookmark disappears too. Recalled (soft-deleted) messages stay listed as tombstones.

### 2.2 `scheduled_messages` (outbox — per sender, private)

```sql
CREATE TABLE public.scheduled_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  reply_to        UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','sent','canceled','failed')),
  sent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (scheduled_at > created_at)
);
-- idx: (status, scheduled_at) WHERE status='pending'  → cron scan
-- idx: (sender_id, room_id, scheduled_at)             → per-room pending list
```

## 3. Functions & Automation

### 3.1 `set_message_pin(p_message_id UUID, p_pinned BOOLEAN) RETURNS messages`

`SECURITY DEFINER`, `SET search_path = ''`. Validates:
1. caller is a participant of the message's room,
2. message is not deleted.

Then sets/clears `pinned_at`/`pinned_by`. RPC (not a broad UPDATE policy) because granting
participants UPDATE on `messages` would let them alter other people's content.

### 3.2 `process_scheduled_messages() RETURNS void`

`SECURITY DEFINER`. For each `pending` row with `scheduled_at <= now()` (with
`FOR UPDATE SKIP LOCKED` — safe under concurrent cron runs):
- sender still a participant → INSERT into `messages` (fires the existing push trigger),
  mark `sent` + link `sent_message_id`;
- sender left the room → mark `failed`.

### 3.3 pg_cron

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('process-scheduled-messages', '* * * * *',
                     'SELECT public.process_scheduled_messages()');
```
(idempotent: unschedules an existing job with the same name first)

### 3.4 `get_user_rooms` — recall-aware preview (same signature)

The lateral last-message subquery now returns `NULL` content when `deleted_at IS NOT NULL`,
so room-list previews don't leak recalled text. Return type unchanged ⇒ old clients unaffected.

## 4. RLS Matrix

### `messages` (existing policies untouched — analysis of why they suffice)

| Action | Policy | Verdict |
|---|---|---|
| Edit / recall (soft delete) | `messages_update USING (auth.uid() = sender_id)` | ✅ sender-only, both are UPDATEs |
| Undo send (hard delete) | `messages_delete USING (auth.uid() = sender_id)` | ✅ existing |
| Pin/unpin by non-sender | ❌ blocked by RLS by design | ✅ handled by `set_message_pin` RPC |
| Read tombstones | `messages_select` (participants) | ✅ tombstone must stay visible |

### `saved_messages` (RLS enabled)

| Policy | Rule |
|---|---|
| SELECT | `user_id = auth.uid()` |
| INSERT | `user_id = auth.uid()` **AND** caller participates in the message's room (no bookmarking foreign rooms) |
| DELETE | `user_id = auth.uid()` |
| UPDATE | none (rows are immutable) |

### `scheduled_messages` (RLS enabled)

| Policy | Rule |
|---|---|
| SELECT | `sender_id = auth.uid()` |
| INSERT | `sender_id = auth.uid()` **AND** caller is a participant of `room_id` |
| DELETE (cancel) | `sender_id = auth.uid()` **AND** `status = 'pending'` |
| UPDATE | none for clients; cron function is `SECURITY DEFINER` and bypasses RLS |

## 5. Realtime

- `messages` already in `supabase_realtime` — pin/edit/recall arrive as UPDATE, undo send as
  DELETE, scheduled sends as INSERT. **No publication changes needed.**
- `saved_messages` / `scheduled_messages` intentionally NOT published (private, low-churn;
  fetched on demand).

## 6. Backward Compatibility Checklist

- [x] All new `messages` columns nullable / generated — `SELECT *` and existing inserts unaffected
- [x] CHECK constraint widened, never narrowed
- [x] No policy dropped or weakened; new tables locked down by default
- [x] `get_user_rooms` signature identical
- [x] Old clients hard-delete instead of recalling — allowed by design (undo-send path uses the same policy)
- [x] Push trigger untouched; scheduled sends reuse it

## 7. Client Type Impact

After type regen, `src/types/index.ts` gains:
`SavedMessage`, `ScheduledMessage` aliases; `Message` picks up `pinned_at`, `pinned_by`,
`deleted_at`, `deleted_by`, `has_link`. Embeds joining `messages → profiles` must use the
FK hint `profiles!messages_sender_id_fkey` (two new FKs to `profiles` make the bare embed ambiguous).

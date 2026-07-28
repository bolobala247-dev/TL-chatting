-- ============================================
-- Talo: Core messaging features
-- Pinned messages, Saved messages, Shared media lanes,
-- Delete for everyone (recall), Scheduled messages
-- See DATABASE_CHANGES.md for the full design rationale.
-- ============================================

-- ============================================
-- 1. MESSAGES: new columns (all additive / nullable)
-- ============================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Index-backed "links" lane for shared media (avoids ILIKE table scans)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS has_link BOOLEAN
  GENERATED ALWAYS AS (COALESCE(content ~* 'https?://[^[:space:]]+', FALSE)) STORED;

-- Widen the type CHECK to allow videos (widening only: existing rows still pass)
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'file', 'system'));

-- Partial indexes: pins, media and links stay fast in very large rooms
CREATE INDEX IF NOT EXISTS idx_messages_room_pinned
  ON public.messages(room_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_room_media
  ON public.messages(room_id, created_at DESC)
  WHERE type IN ('image', 'video', 'file') AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_room_links
  ON public.messages(room_id, created_at DESC)
  WHERE has_link AND deleted_at IS NULL;

-- Integrity guard: a recalled message is immutable (no stale-client edit/re-pin)
CREATE OR REPLACE FUNCTION public.block_update_after_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'message has been deleted and can no longer be modified';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_block_update_after_delete ON public.messages;
CREATE TRIGGER messages_block_update_after_delete
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.block_update_after_delete();

-- ============================================
-- 2. PIN RPC
-- Any participant may pin/unpin, but messages_update RLS is sender-only,
-- so pinning goes through a SECURITY DEFINER function with its own checks.
-- ============================================

CREATE OR REPLACE FUNCTION public.set_message_pin(p_message_id UUID, p_pinned BOOLEAN)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_msg public.messages;
BEGIN
  SELECT * INTO v_msg FROM public.messages WHERE id = p_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message not found';
  END IF;

  IF v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot pin a deleted message';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = v_msg.room_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a participant of this room';
  END IF;

  UPDATE public.messages
  SET pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END,
      pinned_by = CASE WHEN p_pinned THEN auth.uid() ELSE NULL END
  WHERE id = p_message_id
  RETURNING * INTO v_msg;

  RETURN v_msg;
END;
$$;

-- ============================================
-- 3. SAVED MESSAGES (favorites — private per user)
-- ============================================

CREATE TABLE IF NOT EXISTS public.saved_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_messages_user_created
  ON public.saved_messages(user_id, created_at DESC);

ALTER TABLE public.saved_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_messages_select" ON public.saved_messages
  FOR SELECT USING (user_id = auth.uid());

-- Only own bookmarks, and only for messages in rooms the user belongs to
CREATE POLICY "saved_messages_insert" ON public.saved_messages
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.room_participants rp ON rp.room_id = m.room_id
      WHERE m.id = saved_messages.message_id
        AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "saved_messages_delete" ON public.saved_messages
  FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- 4. SCHEDULED MESSAGES (outbox — private per sender)
-- ============================================

CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'canceled', 'failed')),
  sent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (scheduled_at > created_at)
);

-- Cron scan only ever touches due pending rows
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
  ON public.scheduled_messages(status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_sender_room
  ON public.scheduled_messages(sender_id, room_id, scheduled_at);

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_messages_select" ON public.scheduled_messages
  FOR SELECT USING (sender_id = auth.uid());

CREATE POLICY "scheduled_messages_insert" ON public.scheduled_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = scheduled_messages.room_id AND user_id = auth.uid()
    )
  );

-- Cancel = delete the pending row (sent/failed rows are history, kept immutable)
CREATE POLICY "scheduled_messages_delete" ON public.scheduled_messages
  FOR DELETE USING (sender_id = auth.uid() AND status = 'pending');

-- ============================================
-- 5. SCHEDULED DELIVERY (pg_cron, every minute)
-- ============================================

CREATE OR REPLACE FUNCTION public.process_scheduled_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.scheduled_messages;
  v_message_id UUID;
BEGIN
  FOR v_row IN
    SELECT * FROM public.scheduled_messages
    WHERE status = 'pending' AND scheduled_at <= now()
    ORDER BY scheduled_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Sender must still be in the room at fire time
    IF EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = v_row.room_id AND user_id = v_row.sender_id
    ) THEN
      -- INSERT fires the existing push-notification trigger automatically
      INSERT INTO public.messages (room_id, sender_id, content, type, reply_to)
      VALUES (v_row.room_id, v_row.sender_id, v_row.content, 'text', v_row.reply_to)
      RETURNING id INTO v_message_id;

      UPDATE public.scheduled_messages
      SET status = 'sent', sent_message_id = v_message_id
      WHERE id = v_row.id;
    ELSE
      UPDATE public.scheduled_messages
      SET status = 'failed'
      WHERE id = v_row.id;
    END IF;
  END LOOP;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent schedule: drop a previous job with the same name if present
DO $$
BEGIN
  PERFORM cron.unschedule('process-scheduled-messages');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'process-scheduled-messages',
  '* * * * *',
  'SELECT public.process_scheduled_messages()'
);

-- ============================================
-- 6. GET_USER_ROOMS: recall-aware last-message preview
-- (same signature as 00005 — only the lateral content changes)
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_rooms(p_user_id UUID)
RETURNS TABLE (
  room_id UUID,
  room_type TEXT,
  room_name TEXT,
  room_avatar TEXT,
  last_message_content TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_sender TEXT,
  unread_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id AS room_id,
    r.type AS room_type,
    r.name AS room_name,
    r.avatar_url AS room_avatar,
    lm.content AS last_message_content,
    lm.created_at AS last_message_at,
    p.display_name AS last_message_sender,
    COALESCE(uc.cnt, 0) AS unread_count
  FROM public.room_participants rp
  JOIN public.rooms r ON r.id = rp.room_id
  LEFT JOIN LATERAL (
    -- Recalled messages keep their slot but never leak content
    SELECT
      CASE WHEN msg.deleted_at IS NOT NULL THEN NULL ELSE msg.content END AS content,
      msg.created_at,
      msg.sender_id
    FROM public.messages msg
    WHERE msg.room_id = r.id
    ORDER BY msg.created_at DESC
    LIMIT 1
  ) lm ON TRUE
  LEFT JOIN public.profiles p ON p.id = lm.sender_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM public.messages m
    WHERE m.room_id = r.id
      AND m.created_at > rp.last_read_at
      AND m.sender_id <> p_user_id
  ) uc ON TRUE
  WHERE rp.user_id = p_user_id
  ORDER BY lm.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

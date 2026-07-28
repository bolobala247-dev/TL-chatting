-- ============================================
-- Talo: Productivity features
-- Emoji reactions, poll messages, multiple attachments / image albums.
-- Drafts and detailed read receipts are client-side / derived and need
-- no schema (drafts persist on-device; receipts derive from
-- room_participants.last_read_at).
-- ============================================

-- ============================================
-- 1. MESSAGES: attachments + poll metadata (additive / nullable)
-- ============================================

-- attachments: JSON array of { url, width?, height? } for image albums.
--   media_url stays populated with the first URL for backward compatibility
--   with old clients and the shared-media lanes.
-- metadata:    poll definition { question, options: string[] } (immutable).
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS attachments JSONB,
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Widen the type CHECK to allow polls (widening only: existing rows still pass)
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'file', 'system', 'poll'));

-- ============================================
-- 2. MESSAGE REACTIONS
-- room_id is denormalized so realtime can filter by room on the existing
-- room:{roomId} channel and RLS can reuse get_my_room_ids() (no recursion).
-- ============================================

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON public.message_reactions(message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_reactions_select" ON public.message_reactions
  FOR SELECT USING (room_id IN (SELECT public.get_my_room_ids()));

CREATE POLICY "message_reactions_insert" ON public.message_reactions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND room_id IN (SELECT public.get_my_room_ids())
  );

CREATE POLICY "message_reactions_delete" ON public.message_reactions
  FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- 3. POLL VOTES
-- Single choice per user (vote change = upsert on the unique key).
-- ============================================

CREATE TABLE IF NOT EXISTS public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  option_index INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_poll_votes_message
  ON public.poll_votes(message_id);

ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "poll_votes_select" ON public.poll_votes
  FOR SELECT USING (room_id IN (SELECT public.get_my_room_ids()));

CREATE POLICY "poll_votes_insert" ON public.poll_votes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND room_id IN (SELECT public.get_my_room_ids())
  );

CREATE POLICY "poll_votes_update" ON public.poll_votes
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "poll_votes_delete" ON public.poll_votes
  FOR DELETE USING (user_id = auth.uid());

-- ============================================
-- 4. REALTIME
-- DELETE payloads need the old row's room_id to filter, so both tables use
-- REPLICA IDENTITY FULL.
-- ============================================

ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.poll_votes REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_votes;

-- ============================================
-- 5. GET_USER_ROOMS: expose last_message_type for room-list previews
-- (return signature changes, so drop then recreate)
-- ============================================

DROP FUNCTION IF EXISTS public.get_user_rooms(UUID);

CREATE FUNCTION public.get_user_rooms(p_user_id UUID)
RETURNS TABLE (
  room_id UUID,
  room_type TEXT,
  room_name TEXT,
  room_avatar TEXT,
  last_message_content TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_sender TEXT,
  last_message_type TEXT,
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
    lm.type AS last_message_type,
    COALESCE(uc.cnt, 0) AS unread_count
  FROM public.room_participants rp
  JOIN public.rooms r ON r.id = rp.room_id
  LEFT JOIN LATERAL (
    -- Recalled messages keep their slot but never leak content
    SELECT
      CASE WHEN msg.deleted_at IS NOT NULL THEN NULL ELSE msg.content END AS content,
      msg.created_at,
      msg.sender_id,
      msg.type
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

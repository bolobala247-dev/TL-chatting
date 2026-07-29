-- ============================================
-- Talo: Search & Organization
-- Global message search (trigram), message threads,
-- conversation bookmarks. Mentions reuse messages.metadata
-- (no schema change needed).
-- ============================================

-- ============================================
-- 1. SEARCH INDEX
-- pg_trgm GIN index backs ILIKE '%q%' substring search — works for
-- Vietnamese (no stemming needed, unlike tsvector). Partial: recalled
-- and content-less rows are never searchable.
-- ============================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON public.messages USING GIN (content gin_trgm_ops)
  WHERE deleted_at IS NULL AND content IS NOT NULL;

-- ============================================
-- 2. MESSAGE THREADS
-- thread_id points at the thread root message. Replies inherit the
-- root's id (flat threads, no nesting): client sets
-- thread_id = reply_to.thread_id ?? reply_to.id.
-- Covered by existing messages RLS (row shape unchanged).
-- ============================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread
  ON public.messages(thread_id, created_at)
  WHERE thread_id IS NOT NULL;

-- ============================================
-- 3. CONVERSATION BOOKMARKS
-- Per-user, per-room pin timestamp. Existing participants_update
-- policy (auth.uid() = user_id) already lets owners toggle it —
-- no new policy or RPC needed.
-- ============================================

ALTER TABLE public.room_participants
  ADD COLUMN IF NOT EXISTS bookmarked_at TIMESTAMPTZ;

-- ============================================
-- 4. SEARCH RPC
-- Single entry point for the message / image / file / link lanes of
-- global search. Scoped to the caller's rooms via get_my_room_ids();
-- recalled and system messages never surface. For media lanes an
-- empty query browses recent items (caption/file-name match otherwise).
-- ============================================

CREATE OR REPLACE FUNCTION public.search_messages(
  p_query TEXT,
  p_kind TEXT DEFAULT 'message',
  p_room_id UUID DEFAULT NULL,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INT DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  room_id UUID,
  sender_id UUID,
  content TEXT,
  type TEXT,
  media_url TEXT,
  attachments JSONB,
  created_at TIMESTAMPTZ,
  sender_name TEXT,
  sender_avatar TEXT,
  room_name TEXT,
  room_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    m.id,
    m.room_id,
    m.sender_id,
    m.content,
    m.type,
    m.media_url,
    m.attachments,
    m.created_at,
    p.display_name AS sender_name,
    -- Sender always shares a room with the caller, so 'contacts'
    -- avatar visibility is satisfied — no masking needed here.
    p.avatar_url AS sender_avatar,
    COALESCE(r.name, peer.display_name) AS room_name,
    r.type AS room_type
  FROM public.messages m
  JOIN public.rooms r ON r.id = m.room_id
  LEFT JOIN public.profiles p ON p.id = m.sender_id
  -- DM rooms have no name: show the other participant's name
  LEFT JOIN LATERAL (
    SELECT pr.display_name
    FROM public.room_participants rp2
    JOIN public.profiles pr ON pr.id = rp2.user_id
    WHERE rp2.room_id = m.room_id
      AND rp2.user_id <> auth.uid()
      AND r.type = 'direct'
    LIMIT 1
  ) peer ON TRUE
  WHERE m.room_id IN (SELECT public.get_my_room_ids())
    AND (p_room_id IS NULL OR m.room_id = p_room_id)
    AND m.deleted_at IS NULL
    AND m.type <> 'system'
    AND (p_before IS NULL OR m.created_at < p_before)
    AND (
      (p_kind = 'image' AND m.type IN ('image', 'video'))
      OR (p_kind = 'file' AND m.type = 'file')
      OR (p_kind = 'link' AND m.has_link)
      OR (p_kind = 'message' AND m.type IN ('text', 'image', 'video', 'file'))
    )
    AND (
      CASE
        WHEN p_kind = 'message' THEN
          m.content IS NOT NULL
          AND m.content ILIKE '%' || p_query || '%'
        ELSE
          btrim(COALESCE(p_query, '')) = ''
          OR m.content ILIKE '%' || p_query || '%'
      END
    )
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

REVOKE ALL ON FUNCTION public.search_messages(TEXT, TEXT, UUID, TIMESTAMPTZ, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_messages(TEXT, TEXT, UUID, TIMESTAMPTZ, INT) TO authenticated;

-- ============================================
-- 5. GET_USER_ROOMS: bookmarks first
-- Return type changes (adds bookmarked_at) so DROP + CREATE.
-- Also restores two features 00011 accidentally dropped:
-- last_message_type and the private room_reads watermark +
-- recall-aware preview from 00010.
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
  unread_count BIGINT,
  bookmarked_at TIMESTAMPTZ
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
    COALESCE(uc.cnt, 0) AS unread_count,
    rp.bookmarked_at
  FROM public.room_participants rp
  JOIN public.rooms r ON r.id = rp.room_id
  LEFT JOIN public.room_reads rr
    ON rr.room_id = rp.room_id AND rr.user_id = rp.user_id
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
    -- Private watermark first: stays correct when receipts are disabled
    SELECT COUNT(*) AS cnt
    FROM public.messages m
    WHERE m.room_id = r.id
      AND m.created_at > COALESCE(rr.last_read_at, rp.last_read_at)
      AND m.sender_id <> p_user_id
  ) uc ON TRUE
  WHERE rp.user_id = p_user_id
  ORDER BY rp.bookmarked_at DESC NULLS LAST, lm.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

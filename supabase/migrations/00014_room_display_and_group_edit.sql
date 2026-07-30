-- 00014: Room display + group editing
-- 1. get_user_rooms: DM rooms have no name/avatar — show the OTHER
--    participant's display name + avatar instead (same pattern as
--    search_messages in 00012).
-- 2. rooms UPDATE policy: group admins may edit the group name/avatar.
--    (No UPDATE policy existed before, so all room updates were blocked.)

-- ============================================
-- 1. GET_USER_ROOMS: resolve DM peer name/avatar
-- Return type unchanged from 00012 → CREATE OR REPLACE.
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
  last_message_type TEXT,
  unread_count BIGINT,
  bookmarked_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id AS room_id,
    r.type AS room_type,
    -- DM rooms have no name/avatar: fall back to the other participant's
    CASE WHEN r.type = 'direct'
      THEN COALESCE(r.name, peer.display_name, peer.username)
      ELSE r.name
    END AS room_name,
    CASE WHEN r.type = 'direct'
      THEN COALESCE(r.avatar_url, peer.avatar_url)
      ELSE r.avatar_url
    END AS room_avatar,
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
    SELECT pr.display_name, pr.username, pr.avatar_url
    FROM public.room_participants rp2
    JOIN public.profiles pr ON pr.id = rp2.user_id
    WHERE rp2.room_id = r.id
      AND rp2.user_id <> p_user_id
      AND r.type = 'direct'
    LIMIT 1
  ) peer ON TRUE
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

-- ============================================
-- 2. ROOMS UPDATE: group admins may edit name/avatar
-- ============================================

DROP POLICY IF EXISTS "rooms_update" ON public.rooms;

CREATE POLICY "rooms_update" ON public.rooms
  FOR UPDATE USING (
    type = 'group' AND public.is_room_admin(id)
  ) WITH CHECK (
    type = 'group' AND public.is_room_admin(id)
  );

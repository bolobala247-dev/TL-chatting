-- ============================================
-- Talo: Incremental synchronization (Phase 4)
-- See docs/phase-4-incremental-sync-design.md (esp. §17 corrections C1–C3).
--
-- Enables a delta cursor keyed on messages.updated_at:
--   1. set_updated_at   — BEFORE UPDATE trigger so edit/recall/pin advance
--      updated_at from the SERVER clock (today they don't: recall never
--      touched it, edit used the client clock). Without this the cursor is
--      broken and Invariant #4 (server-only timestamps) is violated.
--   2. touch_message_on_reaction — reaction/vote changes bump the parent
--      message's updated_at so they are delta-visible (Invariant #5).
--   3. idx_messages_room_updated — the delta hot path (room_id, updated_at).
--   4. get_rooms_delta   — room-list delta (get_user_rooms + "changed since").
--
-- The messages delta itself is a plain PostgREST select on the client
-- (updated_at > since, with the existing embeds) — no RPC here (§17 C3).
-- ============================================

-- ============================================
-- 1. MESSAGES: server-clock updated_at on every UPDATE
-- ============================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Independent of messages_block_update_after_delete (00008): both are
-- BEFORE UPDATE row triggers; if the block trigger raises, the statement
-- aborts regardless of firing order, so no interaction to worry about.
DROP TRIGGER IF EXISTS messages_set_updated_at ON public.messages;
CREATE TRIGGER messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- 2. REACTIONS / VOTES: touch the parent message so changes are delta-visible
-- The deleted_at IS NULL guard means we never UPDATE a recalled row, so this
-- can never trip messages_block_update_after_delete. The messages UPDATE it
-- issues fires set_updated_at above (server clock).
-- ============================================

CREATE OR REPLACE FUNCTION public.touch_message_on_reaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target UUID := COALESCE(NEW.message_id, OLD.message_id);
BEGIN
  UPDATE public.messages
     SET updated_at = now()
   WHERE id = target
     AND deleted_at IS NULL;
  RETURN NULL; -- AFTER trigger: return value ignored
END;
$$;

DROP TRIGGER IF EXISTS message_reactions_touch_message ON public.message_reactions;
CREATE TRIGGER message_reactions_touch_message
  AFTER INSERT OR DELETE ON public.message_reactions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_message_on_reaction();

DROP TRIGGER IF EXISTS poll_votes_touch_message ON public.poll_votes;
CREATE TRIGGER poll_votes_touch_message
  AFTER INSERT OR UPDATE OR DELETE ON public.poll_votes
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_message_on_reaction();

-- ============================================
-- 3. DELTA HOT PATH INDEX
-- Serves: WHERE room_id = ? AND updated_at > ? ORDER BY updated_at ASC
-- ============================================

CREATE INDEX IF NOT EXISTS idx_messages_room_updated
  ON public.messages (room_id, updated_at);

-- ============================================
-- 4. GET_ROOMS_DELTA: get_user_rooms restricted to rooms changed since p_since
-- Same return shape as get_user_rooms (00014) so the client reuses
-- RoomWithLastMessage and the existing room-list mapping unchanged.
-- Membership REMOVAL cannot be expressed as a returned row → that case keeps
-- today's full-resync path (design R4); this RPC covers the additive/changed
-- case only.
-- ============================================

CREATE OR REPLACE FUNCTION public.get_rooms_delta(
  p_user_id UUID,
  p_since TIMESTAMPTZ
)
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
      AND m.created_at > COALESCE(rr.last_read_at, rp.last_read_at)
      AND m.sender_id <> p_user_id
  ) uc ON TRUE
  WHERE rp.user_id = p_user_id
    -- "changed since": new/edited last message, read-state move, or bookmark
    AND (
      lm.created_at > p_since
      OR rr.last_read_at > p_since
      OR rp.last_read_at > p_since
      OR rp.bookmarked_at > p_since
    )
  ORDER BY rp.bookmarked_at DESC NULLS LAST, lm.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

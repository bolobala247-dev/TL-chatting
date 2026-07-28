-- ============================================
-- Talo: Privacy controls
-- Last-seen / online visibility, read-receipt & typing settings,
-- profile-photo & phone privacy, block users, report users.
-- Design + threat model: SECURITY_REVIEW.md.
--
-- Enforcement rule: a privacy setting only exists if the server
-- enforces it — peers never read privacy-sensitive tables directly;
-- everything flows through RLS or SECURITY DEFINER RPCs.
-- ============================================

-- ============================================
-- 1. PRIVACY SETTINGS (owner-only — peers go through RPCs)
-- phone_number lives here, NOT on profiles: profiles rows are embedded
-- via profiles(*) all over the app and are readable by room-mates.
-- ============================================

CREATE TABLE IF NOT EXISTS public.privacy_settings (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_seen_visibility TEXT NOT NULL DEFAULT 'contacts'
    CHECK (last_seen_visibility IN ('everyone', 'contacts', 'nobody')),
  online_visibility TEXT NOT NULL DEFAULT 'contacts'
    CHECK (online_visibility IN ('everyone', 'contacts', 'nobody')),
  read_receipts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  typing_indicators_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  avatar_visibility TEXT NOT NULL DEFAULT 'everyone'
    CHECK (avatar_visibility IN ('everyone', 'contacts')),
  phone_visibility TEXT NOT NULL DEFAULT 'nobody'
    CHECK (phone_visibility IN ('contacts', 'nobody')),
  phone_number TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.privacy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "privacy_settings_select" ON public.privacy_settings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "privacy_settings_insert" ON public.privacy_settings
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "privacy_settings_update" ON public.privacy_settings
  FOR UPDATE USING (user_id = auth.uid());

-- Backfill existing users with defaults
INSERT INTO public.privacy_settings (user_id)
SELECT id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;

-- ============================================
-- 2. USER PRESENCE (heartbeat store, owner-only)
-- profiles.status / profiles.last_seen_at stay dead on purpose: they sit
-- in a peer-readable table (SECURITY_REVIEW.md F-9). Peers read presence
-- exclusively through get_peer_profile().
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_presence_select" ON public.user_presence
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_presence_insert" ON public.user_presence
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_presence_update" ON public.user_presence
  FOR UPDATE USING (user_id = auth.uid());

-- ============================================
-- 3. ROOM READS (private read watermark, owner-only)
-- Splitting the watermark from room_participants.last_read_at is what
-- makes the read-receipt opt-out server-enforced: the private copy keeps
-- the user's own unread counts working, the public copy is only mirrored
-- when read_receipts_enabled (see mark_room_read below).
-- ============================================

CREATE TABLE IF NOT EXISTS public.room_reads (
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (room_id, user_id)
);

ALTER TABLE public.room_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "room_reads_select" ON public.room_reads
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "room_reads_insert" ON public.room_reads
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "room_reads_update" ON public.room_reads
  FOR UPDATE USING (user_id = auth.uid());

-- Seed from the legacy public watermark so unread counts don't jump
INSERT INTO public.room_reads (room_id, user_id, last_read_at)
SELECT room_id, user_id, COALESCE(last_read_at, now())
FROM public.room_participants
ON CONFLICT (room_id, user_id) DO NOTHING;

-- Owner-only rows + RLS-filtered realtime = only my own devices receive
-- these events (cross-device unread sync when receipts are off).
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_reads;

-- ============================================
-- 4. USER BLOCKS
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON public.user_blocks(blocked_id);

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_blocks_select" ON public.user_blocks
  FOR SELECT USING (blocker_id = auth.uid());

CREATE POLICY "user_blocks_insert" ON public.user_blocks
  FOR INSERT WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "user_blocks_delete" ON public.user_blocks
  FOR DELETE USING (blocker_id = auth.uid());

-- ============================================
-- 5. USER REPORTS
-- Insert goes through submit_report() only (no INSERT policy): the RPC
-- validates visibility and snapshots the message content server-side so
-- evidence survives a recall. Triage is dashboard / service-role only.
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('spam', 'harassment', 'hate', 'scam', 'other')),
  details TEXT,
  message_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_reports_status
  ON public.user_reports(status, created_at DESC);

ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_reports_select" ON public.user_reports
  FOR SELECT USING (reporter_id = auth.uid());

-- ============================================
-- 6. HELPERS (SECURITY DEFINER, auth.uid()-bound — no third-party probing)
-- ============================================

-- Does the current user share at least one room with p_user?
-- ("contacts" definition — the app has no address book)
CREATE OR REPLACE FUNCTION public.shares_room_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.room_participants mine
    JOIN public.room_participants theirs
      ON theirs.room_id = mine.room_id
    WHERE mine.user_id = auth.uid()
      AND theirs.user_id = p_user_id
  );
$$;

-- Is there a block in either direction between the current user and p_user?
CREATE OR REPLACE FUNCTION public.is_blocked_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_blocks
    WHERE (blocker_id = auth.uid() AND blocked_id = p_user_id)
       OR (blocker_id = p_user_id AND blocked_id = auth.uid())
  );
$$;

-- Direct room whose two participants have a block between them (either
-- direction) — used to shut down sends in blocked DMs. Group rooms are
-- deliberately unaffected (industry-standard block semantics).
CREATE OR REPLACE FUNCTION public.is_dm_blocked(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rooms r
    JOIN public.user_blocks ub
      ON ub.blocker_id IN (
           SELECT user_id FROM public.room_participants WHERE room_id = r.id
         )
     AND ub.blocked_id IN (
           SELECT user_id FROM public.room_participants WHERE room_id = r.id
         )
    WHERE r.id = p_room_id
      AND r.type = 'direct'
  );
$$;

-- Guard for participants_insert: adding p_user to a DIRECT room is denied
-- when a block exists between the current user and p_user.
CREATE OR REPLACE FUNCTION public.is_dm_peer_blocked(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id AND type = 'direct'
  )
  AND public.is_blocked_with(p_user_id);
$$;

REVOKE ALL ON FUNCTION public.shares_room_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_blocked_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_dm_blocked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_dm_peer_blocked(UUID, UUID) FROM PUBLIC;
-- RLS expressions evaluate under the caller's role, so authenticated
-- needs EXECUTE on the policy helpers.
GRANT EXECUTE ON FUNCTION public.shares_room_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_dm_blocked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_dm_peer_blocked(UUID, UUID) TO authenticated;

-- ============================================
-- 7. RLS TIGHTENING (SECURITY_REVIEW.md F-1)
-- ============================================

-- profiles: was USING (true) with no TO clause — anon could enumerate all
-- users. Now: self or room-mates only; discovery moves to search_profiles().
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.shares_room_with(id));

-- messages: blocked DMs reject sends in both directions at the database
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND messages.room_id IN (SELECT public.get_my_room_ids())
    AND NOT public.is_dm_blocked(messages.room_id)
  );

-- room_participants: cannot start a DM with someone who blocked you
-- (or whom you blocked) — group membership is unaffected.
DROP POLICY IF EXISTS "participants_insert" ON public.room_participants;
CREATE POLICY "participants_insert" ON public.room_participants
  FOR INSERT WITH CHECK (
    (
      auth.uid() = user_id
      OR public.is_room_admin(room_id)
      OR public.is_room_creator(room_id)
    )
    AND NOT public.is_dm_peer_blocked(room_id, user_id)
  );

-- ============================================
-- 8. RPCs (the only peer-facing surface for private data)
-- ============================================

-- Registration availability check — replaces the direct profiles SELECT
-- that the tightened policy no longer allows for anon.
CREATE OR REPLACE FUNCTION public.is_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = lower(p_username)
  );
$$;

REVOKE ALL ON FUNCTION public.is_username_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_username_available(TEXT) TO anon, authenticated;

-- User discovery — replaces profileService.searchUsers' direct table scan.
-- Honors avatar_visibility and hides blocked relationships in both
-- directions. Returns only the four public columns.
CREATE OR REPLACE FUNCTION public.search_profiles(p_query TEXT)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT
    p.id,
    p.username,
    p.display_name,
    CASE
      WHEN COALESCE(ps.avatar_visibility, 'everyone') = 'everyone'
        OR public.shares_room_with(p.id)
      THEN p.avatar_url
      ELSE NULL
    END AS avatar_url
  FROM public.profiles p
  LEFT JOIN public.privacy_settings ps ON ps.user_id = p.id
  WHERE p.id <> auth.uid()
    AND (
      p.username ILIKE '%' || p_query || '%'
      OR p.display_name ILIKE '%' || p_query || '%'
    )
    AND NOT public.is_blocked_with(p.id)
  ORDER BY p.username
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_profiles(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT) TO authenticated;

-- Peer profile card: the single gateway for presence, phone and avatar.
-- Everything the target restricted comes back NULL/false — the raw tables
-- are never readable by peers.
CREATE OR REPLACE FUNCTION public.get_peer_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  phone_number TEXT,
  is_online BOOLEAN,
  last_seen_at TIMESTAMPTZ,
  is_blocked_by_me BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_is_contact BOOLEAN;
  v_blocked BOOLEAN;
  v_ps public.privacy_settings;
  v_last_active TIMESTAMPTZ;
BEGIN
  IF v_caller IS NULL OR p_user_id = v_caller THEN
    RETURN;
  END IF;

  v_is_contact := public.shares_room_with(p_user_id);
  v_blocked := public.is_blocked_with(p_user_id);

  SELECT * INTO v_ps
  FROM public.privacy_settings ps
  WHERE ps.user_id = p_user_id;

  SELECT up.last_active_at INTO v_last_active
  FROM public.user_presence up
  WHERE up.user_id = p_user_id;

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    p.display_name,
    CASE
      WHEN v_blocked THEN NULL
      WHEN COALESCE(v_ps.avatar_visibility, 'everyone') = 'everyone'
        OR v_is_contact
      THEN p.avatar_url
      ELSE NULL
    END,
    CASE
      WHEN NOT v_blocked
        AND COALESCE(v_ps.phone_visibility, 'nobody') = 'contacts'
        AND v_is_contact
      THEN v_ps.phone_number
      ELSE NULL
    END,
    (
      NOT v_blocked
      AND v_last_active IS NOT NULL
      AND v_last_active > now() - INTERVAL '75 seconds'
      AND (
        COALESCE(v_ps.online_visibility, 'contacts') = 'everyone'
        OR (COALESCE(v_ps.online_visibility, 'contacts') = 'contacts' AND v_is_contact)
      )
    ),
    CASE
      WHEN NOT v_blocked
        AND (
          COALESCE(v_ps.last_seen_visibility, 'contacts') = 'everyone'
          OR (COALESCE(v_ps.last_seen_visibility, 'contacts') = 'contacts' AND v_is_contact)
        )
      THEN v_last_active
      ELSE NULL
    END,
    EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE ub.blocker_id = v_caller AND ub.blocked_id = p_user_id
    )
  FROM public.profiles p
  WHERE p.id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_peer_profile(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_peer_profile(UUID) TO authenticated;

-- Blocked-list management screen: blocked users may no longer be readable
-- through profiles RLS (no shared room), so resolve names here.
CREATE OR REPLACE FUNCTION public.get_blocked_profiles()
RETURNS TABLE (
  id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  blocked_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id, p.username, p.display_name, p.avatar_url, ub.created_at
  FROM public.user_blocks ub
  JOIN public.profiles p ON p.id = ub.blocked_id
  WHERE ub.blocker_id = auth.uid()
  ORDER BY ub.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_blocked_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_blocked_profiles() TO authenticated;

-- Read watermark: private copy always moves (own unread counts); the
-- public room_participants.last_read_at — what peers' receipt sheets and
-- realtime see — only moves when read receipts are enabled.
CREATE OR REPLACE FUNCTION public.mark_room_read(p_room_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = p_room_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a participant of this room';
  END IF;

  INSERT INTO public.room_reads (room_id, user_id, last_read_at)
  VALUES (p_room_id, auth.uid(), now())
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET last_read_at = now();

  IF COALESCE(
    (SELECT read_receipts_enabled FROM public.privacy_settings
     WHERE user_id = auth.uid()),
    TRUE
  ) THEN
    UPDATE public.room_participants
    SET last_read_at = now()
    WHERE room_id = p_room_id AND user_id = auth.uid();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_room_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_room_read(UUID) TO authenticated;

-- Report a user: validates the reporter can actually see the reported
-- message and snapshots its content so evidence survives a recall.
CREATE OR REPLACE FUNCTION public.submit_report(
  p_reported_user_id UUID,
  p_reason TEXT,
  p_message_id UUID DEFAULT NULL,
  p_details TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_msg public.messages;
  v_report_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_reported_user_id = v_caller THEN
    RAISE EXCEPTION 'cannot report yourself';
  END IF;

  IF p_message_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.messages WHERE id = p_message_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'message not found';
    END IF;

    IF v_msg.sender_id <> p_reported_user_id THEN
      RAISE EXCEPTION 'message was not sent by the reported user';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = v_msg.room_id AND user_id = v_caller
    ) THEN
      RAISE EXCEPTION 'not a participant of this room';
    END IF;
  END IF;

  INSERT INTO public.user_reports (
    reporter_id, reported_user_id, room_id, message_id,
    reason, details, message_snapshot
  )
  VALUES (
    v_caller, p_reported_user_id, v_msg.room_id, p_message_id,
    p_reason, NULLIF(trim(p_details), ''), v_msg.content
  )
  RETURNING public.user_reports.id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_report(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_report(UUID, TEXT, UUID, TEXT) TO authenticated;

-- ============================================
-- 9. SIGNUP TRIGGER: also provision privacy defaults
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  );

  -- Privacy defaults exist from the first session (owner-only row)
  INSERT INTO public.privacy_settings (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ============================================
-- 10. GET_USER_ROOMS: unread counts move to the private watermark
-- (same signature as 00009 — only the lateral count changes)
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
  ORDER BY lm.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

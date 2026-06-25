-- ============================================
-- TL-Chatting: Initial Database Schema
-- ============================================

-- 1. PROFILES TABLE
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'away')),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_profiles_username ON public.profiles(username);

-- 2. ROOMS TABLE
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name TEXT,
  avatar_url TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. ROOM PARTICIPANTS TABLE
CREATE TABLE public.room_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  last_read_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(room_id, user_id)
);

CREATE INDEX idx_participants_room ON public.room_participants(room_id);
CREATE INDEX idx_participants_user ON public.room_participants(user_id);

-- 4. MESSAGES TABLE
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT,
  type TEXT DEFAULT 'text' CHECK (type IN ('text', 'image', 'file', 'system')),
  media_url TEXT,
  reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  is_edited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_messages_room_created ON public.messages(room_id, created_at DESC);
CREATE INDEX idx_messages_sender ON public.messages(sender_id);

-- ============================================
-- 5. ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- PROFILES policies
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- ROOMS policies
CREATE POLICY "rooms_select" ON public.rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = rooms.id AND user_id = auth.uid()
    )
  );

CREATE POLICY "rooms_insert" ON public.rooms
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- ROOM_PARTICIPANTS policies
CREATE POLICY "participants_select" ON public.room_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id = room_participants.room_id
        AND rp.user_id = auth.uid()
    )
  );

CREATE POLICY "participants_insert" ON public.room_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = room_participants.room_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
    OR auth.uid() = user_id
  );

CREATE POLICY "participants_update" ON public.room_participants
  FOR UPDATE USING (auth.uid() = user_id);

-- MESSAGES policies
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = messages.room_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.room_participants
      WHERE room_id = messages.room_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "messages_update" ON public.messages
  FOR UPDATE USING (auth.uid() = sender_id);

CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE USING (auth.uid() = sender_id);

-- ============================================
-- 6. AUTO-CREATE PROFILE ON SIGNUP (Trigger)
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 7. GET USER ROOMS FUNCTION
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
    COUNT(m.id) FILTER (
      WHERE m.created_at > rp.last_read_at
    ) AS unread_count
  FROM public.room_participants rp
  JOIN public.rooms r ON r.id = rp.room_id
  LEFT JOIN LATERAL (
    SELECT msg.content, msg.created_at, msg.sender_id
    FROM public.messages msg
    WHERE msg.room_id = r.id
    ORDER BY msg.created_at DESC
    LIMIT 1
  ) lm ON TRUE
  LEFT JOIN public.profiles p ON p.id = lm.sender_id
  LEFT JOIN public.messages m ON m.room_id = r.id
  WHERE rp.user_id = p_user_id
  GROUP BY r.id, r.type, r.name, r.avatar_url,
           lm.content, lm.created_at, p.display_name, rp.last_read_at
  ORDER BY lm.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. ENABLE REALTIME
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_participants;

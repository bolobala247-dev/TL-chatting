-- ============================================
-- Fix RLS infinite recursion on room_participants
-- ============================================

-- Helper function to get current user's room IDs (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_my_room_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT room_id FROM public.room_participants WHERE user_id = auth.uid();
$$;

-- Drop old policies
DROP POLICY IF EXISTS "participants_select" ON public.room_participants;
DROP POLICY IF EXISTS "rooms_select" ON public.rooms;

-- Recreate participants_select using the helper function (no recursion)
CREATE POLICY "participants_select" ON public.room_participants
  FOR SELECT USING (
    room_id IN (SELECT public.get_my_room_ids())
  );

-- Recreate rooms_select using the helper function + allow creator to read
CREATE POLICY "rooms_select" ON public.rooms
  FOR SELECT USING (
    id IN (SELECT public.get_my_room_ids())
    OR auth.uid() = created_by
  );

-- Helper function to check if user is admin in a room (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_room_admin(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- Helper: check if current user is the room creator (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_room_creator(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = p_room_id
      AND created_by = auth.uid()
  );
$$;

-- Drop old participants_insert policy
DROP POLICY IF EXISTS "participants_insert" ON public.room_participants;

-- Recreate: allow self-insert, room admin, or room creator
CREATE POLICY "participants_insert" ON public.room_participants
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    OR public.is_room_admin(room_id)
    OR public.is_room_creator(room_id)
  );

-- Remove a conversation only from the current user's room list.
-- Other participants keep the room and all of its messages.
CREATE OR REPLACE FUNCTION public.remove_room_for_user(p_room_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.room_participants
  WHERE room_id = p_room_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'room membership not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_room_for_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_room_for_user(UUID) TO authenticated;

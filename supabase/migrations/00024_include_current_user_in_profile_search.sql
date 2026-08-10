-- Allow the Contacts screen to find the signed-in account by its username.
-- Callers that use search_profiles to create chats still filter that account
-- client-side, preventing an invalid direct room with duplicate participants.
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
  WHERE (
      p.username ILIKE '%' || p_query || '%'
      OR p.display_name ILIKE '%' || p_query || '%'
    )
    AND (p.id = auth.uid() OR NOT public.is_blocked_with(p.id))
  ORDER BY p.username
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.search_profiles(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles(TEXT) TO authenticated;

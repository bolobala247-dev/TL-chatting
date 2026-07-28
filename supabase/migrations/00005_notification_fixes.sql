-- ============================================
-- TL-Chatting: Notification fixes (audit P2, P3, P8, P10)
-- ============================================
-- 1. Push trigger: read Edge Function URL + shared secret from Vault
--    (no hardcoded project URL, authenticated call, never blocks insert)
-- 2. get_user_rooms: exclude own messages from unread_count and replace
--    the full-history JOIN with an indexed lateral count
--
-- REQUIRED per-project setup (run once in SQL Editor, values differ per env):
--   SELECT vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/send-push-on-message',
--     'push_function_url'
--   );
--   SELECT vault.create_secret('<random-long-secret>', 'push_function_secret');
-- And set the same secret on the Edge Function:
--   supabase secrets set PUSH_FUNCTION_SECRET=<random-long-secret>

-- ============================================
-- 1. PUSH TRIGGER (replaces 00004 version)
-- ============================================

CREATE OR REPLACE FUNCTION public.notify_push_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  function_url text;
  webhook_secret text;
BEGIN
  SELECT decrypted_secret INTO function_url
  FROM vault.decrypted_secrets
  WHERE name = 'push_function_url'
  LIMIT 1;

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'push_function_secret'
  LIMIT 1;

  -- Push not configured on this project: skip silently, never block insert
  IF function_url IS NULL OR webhook_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', to_jsonb(NEW)
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Push delivery must never break message sending
  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged (recreate for idempotency)
DROP TRIGGER IF EXISTS trigger_push_on_message_insert ON public.messages;

CREATE TRIGGER trigger_push_on_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_new_message();

-- ============================================
-- 2. GET_USER_ROOMS: correct + fast unread_count
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
    SELECT msg.content, msg.created_at, msg.sender_id
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

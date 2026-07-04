-- Trigger push notification Edge Function when a new message is inserted.
-- Requires: send-push-on-message Edge Function deployed on the same Supabase project.
-- NOTE: Update project_url if applying to a different Supabase project.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_push_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_url text := 'https://xoxnjqgumfhzwturtfhz.supabase.co';
  function_url text;
BEGIN
  function_url := project_url || '/functions/v1/send-push-on-message';

  PERFORM net.http_post(
    url := function_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'messages',
      'record', to_jsonb(NEW)
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_push_on_message_insert ON public.messages;

CREATE TRIGGER trigger_push_on_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_push_on_new_message();

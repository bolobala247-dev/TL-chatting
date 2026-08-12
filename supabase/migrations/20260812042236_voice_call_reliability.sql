-- Reliable audio-call lifecycle and authenticated Realtime signaling.
-- This migration is additive: existing call rows remain readable and the
-- client can roll back to the previous signaling implementation if needed.

-- Keep call identity immutable and enforce the legal state machine at the
-- database boundary. This also protects the lifecycle when a stale client
-- sends a direct UPDATE instead of using the new RPC.
CREATE OR REPLACE FUNCTION public.guard_voice_call_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid := (select auth.uid());
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.room_id <> OLD.room_id
     OR NEW.caller_id <> OLD.caller_id
     OR NEW.callee_id <> OLD.callee_id
     OR NEW.type <> OLD.type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Call identity cannot be changed';
  END IF;

  IF NEW.status = OLD.status THEN
    NEW.answered_at := OLD.answered_at;
    NEW.ended_at := OLD.ended_at;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('declined', 'missed', 'ended') THEN
    RAISE EXCEPTION 'Terminal call status cannot be changed';
  END IF;

  IF actor IS NULL THEN
    -- Internal Supabase roles (for example Realtime replication) do not
    -- represent a user transition and are allowed to pass through.
    RETURN NEW;
  END IF;

  IF actor NOT IN (OLD.caller_id, OLD.callee_id) THEN
    RAISE EXCEPTION 'Only call participants may change call status';
  END IF;

  IF OLD.status = 'ringing' AND NEW.status = 'answered' AND actor <> OLD.callee_id THEN
    RAISE EXCEPTION 'Only the callee may answer a call';
  END IF;

  IF OLD.status = 'ringing' AND NEW.status = 'declined' AND actor <> OLD.callee_id THEN
    RAISE EXCEPTION 'Only the callee may decline a call';
  END IF;

  IF OLD.status = 'ringing' AND NEW.status NOT IN ('answered', 'declined', 'missed', 'ended') THEN
    RAISE EXCEPTION 'Invalid ringing call transition';
  END IF;

  IF OLD.status = 'answered' AND NEW.status <> 'ended' THEN
    RAISE EXCEPTION 'Answered calls may only end';
  END IF;

  IF NEW.status = 'answered' THEN
    NEW.answered_at := COALESCE(OLD.answered_at, now());
    NEW.ended_at := NULL;
  ELSE
    NEW.ended_at := COALESCE(OLD.ended_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_voice_call_transition ON public.calls;
CREATE TRIGGER trigger_guard_voice_call_transition
  BEFORE UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_voice_call_transition();

-- A single authenticated API for lifecycle transitions. The trigger remains
-- the final guard so old clients cannot bypass the state machine.
CREATE OR REPLACE FUNCTION public.transition_voice_call(
  p_call_id uuid,
  p_status text
)
RETURNS public.calls
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result public.calls;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_status NOT IN ('answered', 'declined', 'missed', 'ended') THEN
    RAISE EXCEPTION 'Unsupported call transition';
  END IF;

  UPDATE public.calls
  SET status = p_status
  WHERE id = p_call_id
    AND (select auth.uid()) IN (caller_id, callee_id)
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'Call not found or not accessible';
  END IF;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_voice_call(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_voice_call(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_voice_call(uuid, text) TO authenticated;

-- Private Broadcast authorization: only the two participants of the call can
-- read/write messages on voice-call:<call UUID> topics.
DROP POLICY IF EXISTS "voice_call_broadcast_read" ON realtime.messages;
CREATE POLICY "voice_call_broadcast_read"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    realtime.topic() ~ '^voice-call:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1
      FROM public.calls c
      WHERE c.id = substring(realtime.topic() FROM 12)::uuid
        AND (select auth.uid()) IN (c.caller_id, c.callee_id)
    )
  );

DROP POLICY IF EXISTS "voice_call_broadcast_write" ON realtime.messages;
CREATE POLICY "voice_call_broadcast_write"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.topic() ~ '^voice-call:[0-9a-fA-F-]{36}$'
    AND EXISTS (
      SELECT 1
      FROM public.calls c
      WHERE c.id = substring(realtime.topic() FROM 12)::uuid
        AND (select auth.uid()) IN (c.caller_id, c.callee_id)
    )
  );

-- Realtime authorization policies are evaluated on the realtime schema; the
-- application table remains the source of truth for participant membership.

-- ============================================
-- Talo: 1:1 Calling (WebRTC signaling metadata + call history)
-- ============================================
-- Media never touches the database — WebRTC is P2P. This migration only
-- stores call lifecycle rows (used for the incoming-call notification via
-- Realtime and for call history) and widens messages.type so every
-- finished call leaves a call-log message in the conversation.

-- ============================================
-- 1. CALLS TABLE
-- ============================================

CREATE TABLE public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES public.profiles(id),
  callee_id UUID NOT NULL REFERENCES public.profiles(id),
  type TEXT NOT NULL CHECK (type IN ('audio', 'video')),
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'answered', 'declined', 'missed', 'ended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

CREATE INDEX idx_calls_room ON public.calls(room_id, created_at DESC);
-- Ringing lookups (busy check, stale-call cleanup) stay cheap
CREATE INDEX idx_calls_callee_ringing ON public.calls(callee_id)
  WHERE status = 'ringing';

-- ============================================
-- 2. RLS
-- ============================================

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calls_select_own" ON public.calls
  FOR SELECT USING (auth.uid() IN (caller_id, callee_id));

-- Only 1:1 rooms both users belong to, and never across a block
CREATE POLICY "calls_insert_caller" ON public.calls
  FOR INSERT WITH CHECK (
    auth.uid() = caller_id
    AND caller_id <> callee_id
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = calls.room_id AND r.type = 'direct'
    )
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id = calls.room_id AND rp.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp2
      WHERE rp2.room_id = calls.room_id AND rp2.user_id = calls.callee_id
    )
    AND NOT public.is_blocked_with(calls.callee_id)
  );

-- Either side moves the call through its lifecycle (answer/decline/end)
CREATE POLICY "calls_update_participants" ON public.calls
  FOR UPDATE
  USING (auth.uid() IN (caller_id, callee_id))
  WITH CHECK (auth.uid() IN (caller_id, callee_id));

-- ============================================
-- 3. REALTIME (incoming-call ring + lifecycle sync)
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;

-- ============================================
-- 4. CALL-LOG MESSAGES
-- ============================================

-- Widen the type CHECK to allow call logs (widening only: existing rows pass)
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages
ADD CONSTRAINT messages_type_check
CHECK (type IN ('text', 'image', 'video', 'file', 'system', 'poll', 'call'));

-- One call-log message per call, written server-side on the first
-- transition into a terminal status (no client double-insert races)
CREATE OR REPLACE FUNCTION public.log_call_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('declined', 'missed', 'ended')
     AND OLD.status NOT IN ('declined', 'missed', 'ended') THEN
    INSERT INTO public.messages (room_id, sender_id, type, metadata)
    VALUES (
      NEW.room_id,
      NEW.caller_id,
      'call',
      jsonb_build_object('call', jsonb_build_object(
        'call_id', NEW.id,
        'call_type', NEW.type,
        'status', NEW.status,
        'duration_seconds', NEW.duration_seconds
      ))
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_log_call_message ON public.calls;

CREATE TRIGGER trigger_log_call_message
  AFTER UPDATE ON public.calls
  FOR EACH ROW
  EXECUTE FUNCTION public.log_call_message();

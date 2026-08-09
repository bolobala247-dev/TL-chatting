-- Reset the previous audio/video call implementation and install the
-- audio-only 1:1 lifecycle used by the new client.

-- Remove old call history before restoring the message type contract.
DELETE FROM public.messages WHERE type = 'call';

DROP TRIGGER IF EXISTS trigger_log_call_message ON public.calls;
DROP FUNCTION IF EXISTS public.log_call_message();
DROP TRIGGER IF EXISTS trigger_push_on_call_insert ON public.calls;
DROP FUNCTION IF EXISTS public.notify_push_on_new_call();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.calls;
  END IF;
END $$;

DROP TABLE IF EXISTS public.calls;

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'file', 'system', 'poll'));

CREATE TABLE public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  caller_id UUID NOT NULL REFERENCES public.profiles(id),
  callee_id UUID NOT NULL REFERENCES public.profiles(id),
  type TEXT NOT NULL DEFAULT 'audio' CHECK (type = 'audio'),
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'answered', 'declined', 'missed', 'ended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_calls_room ON public.calls(room_id, created_at DESC);
CREATE INDEX idx_calls_callee_ringing ON public.calls(callee_id)
  WHERE status = 'ringing';

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calls_select_own" ON public.calls
  FOR SELECT USING (auth.uid() IN (caller_id, callee_id));

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

CREATE POLICY "calls_update_participants" ON public.calls
  FOR UPDATE
  USING (auth.uid() IN (caller_id, callee_id))
  WITH CHECK (auth.uid() IN (caller_id, callee_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;

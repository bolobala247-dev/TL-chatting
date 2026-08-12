-- Enable 1:1 video calls while preserving the existing audio lifecycle and
-- private Realtime signaling channel. Media itself never passes through
-- Supabase; this table only records a TURN admission for quota accounting.

ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_type_check;
ALTER TABLE public.calls
  ADD CONSTRAINT calls_type_check CHECK (type IN ('audio', 'video'));

DROP POLICY IF EXISTS "calls_insert_caller" ON public.calls;
CREATE POLICY "calls_insert_caller" ON public.calls
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = caller_id
    AND caller_id <> callee_id
    AND status = 'ringing'
    AND answered_at IS NULL
    AND ended_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.id = calls.room_id AND r.type = 'direct'
    )
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp
      WHERE rp.room_id = calls.room_id AND rp.user_id = (select auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM public.room_participants rp2
      WHERE rp2.room_id = calls.room_id AND rp2.user_id = calls.callee_id
    )
    AND NOT (select public.is_blocked_with(calls.callee_id))
  );

CREATE TABLE IF NOT EXISTS public.call_turn_admissions (
  call_id UUID PRIMARY KEY REFERENCES public.calls(id) ON DELETE CASCADE,
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.call_turn_admissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_turn_admissions FROM anon, authenticated;
-- The table intentionally has no client policies: only the Edge Function's
-- service-role client reads/writes admissions after participant validation.
CREATE POLICY "call_turn_admissions_no_client_access"
  ON public.call_turn_admissions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_call_turn_admissions_refresh
  ON public.call_turn_admissions(last_refreshed_at);

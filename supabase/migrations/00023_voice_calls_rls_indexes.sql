-- Optimize the audio call RLS predicates and foreign-key lookups.

DROP POLICY IF EXISTS "calls_select_own" ON public.calls;
DROP POLICY IF EXISTS "calls_insert_caller" ON public.calls;
DROP POLICY IF EXISTS "calls_update_participants" ON public.calls;

CREATE POLICY "calls_select_own" ON public.calls
  FOR SELECT USING ((select auth.uid()) IN (caller_id, callee_id));

CREATE POLICY "calls_insert_caller" ON public.calls
  FOR INSERT WITH CHECK (
    (select auth.uid()) = caller_id
    AND caller_id <> callee_id
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

CREATE POLICY "calls_update_participants" ON public.calls
  FOR UPDATE
  USING ((select auth.uid()) IN (caller_id, callee_id))
  WITH CHECK ((select auth.uid()) IN (caller_id, callee_id));

CREATE INDEX IF NOT EXISTS idx_calls_caller ON public.calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON public.calls(callee_id);

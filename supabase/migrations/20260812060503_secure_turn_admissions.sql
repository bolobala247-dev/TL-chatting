-- Keep the internal TURN admission table deny-by-default while giving the
-- security advisor an explicit policy record.
DROP POLICY IF EXISTS "call_turn_admissions_no_client_access" ON public.call_turn_admissions;
CREATE POLICY "call_turn_admissions_no_client_access"
  ON public.call_turn_admissions
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

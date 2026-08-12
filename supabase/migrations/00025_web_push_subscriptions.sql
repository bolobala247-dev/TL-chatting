-- ============================================
-- Talo: Web Push subscriptions
-- ============================================
-- Web subscriptions are managed only by the authenticated Edge Function.
-- The browser never writes this table directly, so the encryption keys and
-- provider endpoint are kept outside the public client Data API surface.

CREATE TABLE public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT web_push_subscriptions_endpoint_key UNIQUE (endpoint),
  CONSTRAINT web_push_subscriptions_endpoint_length CHECK (char_length(endpoint) BETWEEN 1 AND 2048),
  CONSTRAINT web_push_subscriptions_p256dh_length CHECK (char_length(p256dh) BETWEEN 1 AND 512),
  CONSTRAINT web_push_subscriptions_auth_length CHECK (char_length(auth) BETWEEN 1 AND 512)
);

CREATE INDEX idx_web_push_subscriptions_user
  ON public.web_push_subscriptions(user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Do not expose Web Push credentials through PostgREST. The authenticated
-- manage-web-push-subscription function uses the service role after verifying
-- the caller's JWT, and the message webhook uses the same privileged path.
REVOKE ALL ON TABLE public.web_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.web_push_subscriptions TO service_role;

CREATE POLICY web_push_subscriptions_service_role_all
  ON public.web_push_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

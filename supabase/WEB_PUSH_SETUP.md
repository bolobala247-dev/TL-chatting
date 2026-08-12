# Web Push setup

The code path is deployed-safe but Web Push stays disabled until the VAPID
keys and public web environment variable are configured.

## 1. Generate one VAPID key pair

Run this on a machine with Deno. The command prints the private/public JWK JSON
to stdout and the browser public key to stderr:

```bash
deno run https://raw.githubusercontent.com/negrel/webpush/master/cmd/generate-vapid-keys.ts \
  > vapid-keys.json 2> vapid-public-key.txt
```

Keep `vapid-keys.json` private. Never commit either file.
The public-key file includes a label; copy only the URL-safe base64 value after
`your application server key is:`.

## 2. Configure Supabase Edge Function secrets

```bash
supabase secrets set \
  WEB_PUSH_ENABLED=true \
  WEB_PUSH_ALLOWED_ORIGINS=https://tl-chatting.vercel.app \
  WEB_PUSH_VAPID_SUBJECT=mailto:admin@example.com \
  WEB_PUSH_VAPID_KEYS="$(tr -d '\n' < vapid-keys.json)"
```

The project already provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not put the service-role key
in Vercel or in any `EXPO_PUBLIC_*` variable.

## 3. Apply the database migration and deploy functions

```bash
supabase db push
supabase functions deploy manage-web-push-subscription
supabase functions deploy send-push-on-message --no-verify-jwt
```

The `web_push_subscriptions` table deliberately has no `anon` or
`authenticated` Data API grants. The management function validates the user's
JWT itself before using the service role to upsert/delete a subscription. Its
platform JWT check is disabled in `supabase/config.toml` so browser CORS
preflight requests can reach the handler.

Keep the existing `PUSH_FUNCTION_SECRET` secret and Vault entries from the
Android push setup. The database trigger calls `send-push-on-message` with that
secret (and therefore that function must keep JWT verification disabled); the
function still performs its own shared-secret check.

## 4. Configure the web build

Add the public key from `vapid-public-key.txt` to the Vercel **Production** and
**Preview** environment as:

```text
EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=<application-server-public-key>
```

Redeploy the web app after changing it. The browser must be on HTTPS (localhost
is also allowed by browsers), and the user must click **Bật thông báo tin nhắn**
once to grant permission and create the subscription.

## 5. Verify end to end

1. Open the deployed site in Chrome/Edge or Firefox, sign in, and enable message
   notifications in Settings.
2. In DevTools → Application, confirm a root-scoped `/sw.js` is activated and a
   Push subscription exists.
3. Send a message from another account/device while the web tab is backgrounded
   or closed.
4. Confirm the Edge Function response/log reports `webSent > 0`; a stale
   endpoint is automatically removed after a 404/410 response.

Safari supports this only for an installed Home Screen web app on supported
recent versions. Android push behavior remains unchanged and is sent in an
independent branch from Web Push.

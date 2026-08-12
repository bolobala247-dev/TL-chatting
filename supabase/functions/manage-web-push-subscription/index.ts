import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type SubscriptionPayload = {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

type RequestBody = {
  action?: unknown;
  subscription?: SubscriptionPayload;
};

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  const allowedOrigins = (Deno.env.get("WEB_PUSH_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowOrigin =
    !origin ||
    allowedOrigins.length === 0 ||
    allowedOrigins.includes("*") ||
    allowedOrigins.includes(origin)
      ? origin ?? "*"
      : "null";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(
  req: Request,
  body: Record<string, unknown>,
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });
}

function getEndpoint(subscription: SubscriptionPayload | undefined): string {
  const endpoint = subscription?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    throw new Error("A Web Push endpoint is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Invalid Web Push endpoint");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Web Push endpoint must use HTTPS");
  }

  return endpoint;
}

function getKeys(subscription: SubscriptionPayload | undefined): {
  p256dh: string;
  auth: string;
} {
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;

  if (typeof p256dh !== "string" || p256dh.length === 0) {
    throw new Error("Web Push p256dh key is required");
  }
  if (typeof auth !== "string" || auth.length === 0) {
    throw new Error("Web Push auth key is required");
  }

  return { p256dh, auth };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(req, { error: "Missing Supabase environment variables" }, 500);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return jsonResponse(req, { error: "Authentication required" }, 401);
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(
    accessToken
  );

  if (userError || !userData.user) {
    return jsonResponse(req, { error: "Invalid session" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse(req, { error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  if (action !== "subscribe" && action !== "unsubscribe") {
    return jsonResponse(req, { error: "Unsupported action" }, 400);
  }

  try {
    const endpoint = getEndpoint(body.subscription);
    const admin = createClient(supabaseUrl, serviceRoleKey);

    if (action === "unsubscribe") {
      const { error } = await admin
        .from("web_push_subscriptions")
        .delete()
        .eq("user_id", userData.user.id)
        .eq("endpoint", endpoint);

      if (error) throw error;
      return jsonResponse(req, { ok: true });
    }

    const { p256dh, auth } = getKeys(body.subscription);
    const { error } = await admin.from("web_push_subscriptions").upsert(
      {
        user_id: userData.user.id,
        endpoint,
        p256dh,
        auth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

    if (error) throw error;
    return jsonResponse(req, { ok: true });
  } catch (error) {
    console.error("[manage-web-push-subscription]", error);
    return jsonResponse(
      req,
      { error: error instanceof Error ? error.message : "Subscription failed" },
      400
    );
  }
});

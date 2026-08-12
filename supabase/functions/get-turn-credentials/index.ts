import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const TURN_TTL_SECONDS = 60 * 60;
const DEFAULT_TURN_QUOTA_GB = 950;
const BYTES_PER_GB = 1024 ** 3;
const QUOTA_CACHE_MS = 60_000;
const CLOUDFLARE_TURN_BASE = "https://rtc.live.cloudflare.com/v1/turn/keys";
const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

type TurnQuotaSnapshot = {
  egressBytes: number;
  limitBytes: number;
  monthStart: string;
  checkedAt: string;
};

let quotaCache: (TurnQuotaSnapshot & { expiresAt: number }) | null = null;

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("Origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function browserSafeIceServers(iceServers: RTCIceServer[]): RTCIceServer[] {
  return iceServers.map((server) => ({
    ...server,
    urls: Array.isArray(server.urls)
      ? server.urls.filter((url) => !url.includes(":53"))
      : server.urls,
  })).filter((server) => Array.isArray(server.urls) ? server.urls.length > 0 : true);
}

function monthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function quotaLimitBytes(): number {
  const configured = Number(Deno.env.get("TURN_QUOTA_LIMIT_GB") ?? DEFAULT_TURN_QUOTA_GB);
  const limitGb = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TURN_QUOTA_GB;
  return limitGb * BYTES_PER_GB;
}

async function getTurnQuota(
  accountId: string,
  analyticsToken: string,
  now: Date,
): Promise<TurnQuotaSnapshot> {
  if (quotaCache && quotaCache.expiresAt > Date.now()) return quotaCache;

  const monthStart = monthStartIso(now);
  const query = `query {
    viewer {
      accounts(filter: { accountTag: ${JSON.stringify(accountId)} }) {
        callsTurnUsageAdaptiveGroups(
          limit: 10000
          filter: {
            date_geq: ${JSON.stringify(monthStart)}
            date_leq: ${JSON.stringify(now.toISOString())}
          }
        ) {
          sum { egressBytes }
        }
      }
    }
  }`;

  const response = await fetch(CLOUDFLARE_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${analyticsToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    console.error("[get-turn-credentials] Cloudflare analytics request failed", response.status);
    throw new Error("TURN quota unavailable");
  }

  const payload = await response.json() as {
    errors?: unknown[];
    data?: {
      viewer?: {
        accounts?: Array<{
          callsTurnUsageAdaptiveGroups?: Array<{ sum?: { egressBytes?: number } }>;
        }>;
      };
    };
  };
  if (payload.errors?.length) {
    console.error("[get-turn-credentials] Cloudflare analytics returned an error");
    throw new Error("TURN quota unavailable");
  }

  const groups = payload.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups ?? [];
  const egressBytes = groups.reduce(
    (total, group) => total + (group.sum?.egressBytes ?? 0),
    0,
  );
  if (!Number.isFinite(egressBytes) || egressBytes < 0) {
    throw new Error("TURN quota unavailable");
  }

  const snapshot = {
    egressBytes,
    limitBytes: quotaLimitBytes(),
    monthStart,
    checkedAt: now.toISOString(),
    expiresAt: Date.now() + QUOTA_CACHE_MS,
  };
  quotaCache = snapshot;
  return snapshot;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const turnKeyId = Deno.env.get("TURN_KEY_ID");
  const turnApiToken = Deno.env.get("TURN_KEY_API_TOKEN");
  const cloudflareAccountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  // Reuse the TURN token when it also has Account Analytics permission;
  // otherwise provide a separate read-only Analytics token.
  const analyticsToken = Deno.env.get("CLOUDFLARE_ANALYTICS_API_TOKEN") ?? turnApiToken;
  const authorization = req.headers.get("Authorization");

  if (!supabaseUrl || !anonKey || !turnKeyId || !turnApiToken) {
    return json(req, { error: "TURN service is not configured" }, 503);
  }
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return json(req, { error: "Authentication required" }, 401);
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError || !userData.user) return json(req, { error: "Invalid session" }, 401);

  const quotaMonitorConfigured = Boolean(cloudflareAccountId && analyticsToken);
  let quota: TurnQuotaSnapshot | null = null;
  if (quotaMonitorConfigured) {
    try {
      quota = await getTurnQuota(cloudflareAccountId!, analyticsToken!, new Date());
    } catch {
      // Once Analytics is configured, fail closed if the usage check is unavailable.
      return json(req, {
        error: "TURN quota cannot be verified",
        code: "quota-unavailable",
      }, 503);
    }
    if (quota.egressBytes >= quota.limitBytes) {
      return json(req, {
        error: "TURN monthly quota reached",
        code: "quota-exceeded",
        limitGb: quota.limitBytes / BYTES_PER_GB,
        usedGb: quota.egressBytes / BYTES_PER_GB,
        monthStart: quota.monthStart,
        checkedAt: quota.checkedAt,
      }, 429);
    }
  }

  const response = await fetch(
    CLOUDFLARE_TURN_BASE + "/" + encodeURIComponent(turnKeyId) + "/credentials/generate-ice-servers",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${turnApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    },
  );

  if (!response.ok) {
    console.error("[get-turn-credentials] Cloudflare request failed", response.status);
    return json(req, { error: "TURN credentials unavailable" }, 502);
  }

  const payload = await response.json() as { iceServers?: RTCIceServer[] };
  if (!payload.iceServers?.length) return json(req, { error: "TURN returned no ICE servers" }, 502);

  return json(req, {
    iceServers: browserSafeIceServers(payload.iceServers),
    expiresAt: new Date(Date.now() + TURN_TTL_SECONDS * 1000).toISOString(),
    quota: quota
      ? {
          limitGb: quota.limitBytes / BYTES_PER_GB,
          usedGb: quota.egressBytes / BYTES_PER_GB,
          checkedAt: quota.checkedAt,
        }
      : {
          status: "not-configured",
          limitGb: DEFAULT_TURN_QUOTA_GB,
        },
  });
});

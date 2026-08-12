import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";
import {
  ApplicationServer,
  importVapidKeys,
  Urgency,
  type PushSubscription as WebPushSubscription,
} from "@negrel/webpush";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const ANDROID_CHANNEL_ID = "messages";
const EXPO_PUSH_CHUNK_SIZE = 100;

// Localized push copy keyed by the recipient's profiles.preferred_language
type PushLanguage = "en" | "vi";
const DEFAULT_LANGUAGE: PushLanguage = "en";

const PUSH_COPY: Record<
  PushLanguage,
  { sentImage: string; sentFile: string; newMessage: string; userFallback: string }
> = {
  en: {
    sentImage: "Sent a photo",
    sentFile: "Sent a file",
    newMessage: "New message",
    userFallback: "User",
  },
  vi: {
    sentImage: "Đã gửi ảnh",
    sentFile: "Đã gửi tệp",
    newMessage: "Tin nhắn mới",
    userFallback: "Người dùng",
  },
};

function resolveLanguage(value: string | null | undefined): PushLanguage {
  return value === "vi" || value === "en" ? value : DEFAULT_LANGUAGE;
}

interface MessageRecord {
  id: string;
  room_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  created_at: string;
}

interface WebhookPayload {
  type: string;
  table: string;
  record: MessageRecord;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: {
    roomId: string;
    type: string;
    // Phase 11: lets the app deep-link the notification straight to this message
    // (scroll-to-message). Extra keys are ignored by clients that don't use them.
    messageId?: string;
    createdAt?: string;
  };
  channelId?: string;
  priority?: "default" | "normal" | "high";
  sound?: "default";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface WebPushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_id: string;
}

interface DeliveryStats {
  sent: number;
  removed: number;
  failed: number;
}

function getMessagePreview(
  message: MessageRecord,
  language: PushLanguage
): string {
  const copy = PUSH_COPY[language];

  if (message.type === "image") {
    return copy.sentImage;
  }

  if (message.type === "file") {
    return copy.sentFile;
  }

  const content = message.content?.trim();
  return content && content.length > 0 ? content : copy.newMessage;
}

// Sends one chunk and returns tickets in the same order as the input
async function sendExpoPushChunk(
  messages: ExpoPushMessage[]
): Promise<ExpoPushTicket[]> {
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Expo Push API error: ${response.status} ${errorText}`);
  }

  const json = (await response.json()) as { data?: ExpoPushTicket[] };
  return json.data ?? [];
}

function isGoneWebPushError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    isGone?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.isGone === "function") {
    if (Boolean((candidate.isGone as () => boolean)())) return true;
  }
  return (
    candidate.statusCode === 404 ||
    candidate.statusCode === 410 ||
    candidate.response?.status === 404 ||
    candidate.response?.status === 410
  );
}

async function sendAndroidPushNotifications(
  supabase: ReturnType<typeof createClient>,
  recipientIds: string[],
  languageByUserId: Map<string, PushLanguage>,
  message: MessageRecord,
  senderName: string
): Promise<DeliveryStats> {
  const { data: tokens, error: tokensError } = await supabase
    .from("push_tokens")
    .select("token, user_id")
    .in("user_id", recipientIds)
    .eq("platform", "android");

  if (tokensError) throw tokensError;

  const tokenOwners = new Map<string, string>();
  for (const entry of tokens ?? []) {
    if (!tokenOwners.has(entry.token)) {
      tokenOwners.set(entry.token, entry.user_id);
    }
  }

  const pushMessages: ExpoPushMessage[] = [...tokenOwners.entries()].map(
    ([token, userId]) => {
      const language = languageByUserId.get(userId) ?? DEFAULT_LANGUAGE;
      return {
        to: token,
        title: senderName || PUSH_COPY[language].userFallback,
        body: getMessagePreview(message, language),
        data: {
          roomId: message.room_id,
          type: "message",
          messageId: message.id,
          createdAt: message.created_at,
        },
        channelId: ANDROID_CHANNEL_ID,
        priority: "high",
        sound: "default",
      };
    }
  );

  const deadTokens: string[] = [];
  let failed = 0;

  for (let i = 0; i < pushMessages.length; i += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = pushMessages.slice(i, i + EXPO_PUSH_CHUNK_SIZE);
    const tickets = await sendExpoPushChunk(chunk);

    tickets.forEach((ticket, index) => {
      if (
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        deadTokens.push(chunk[index].to);
      } else if (ticket.status === "error") {
        failed += 1;
      }
    });
  }

  if (deadTokens.length > 0) {
    const { error: cleanupError } = await supabase
      .from("push_tokens")
      .delete()
      .in("token", deadTokens);

    if (cleanupError) {
      console.error("[send-push-on-message] android token cleanup", cleanupError);
    }
  }

  return {
    sent: pushMessages.length - deadTokens.length - failed,
    removed: deadTokens.length,
    failed,
  };
}

async function sendWebPushNotifications(
  supabase: ReturnType<typeof createClient>,
  recipientIds: string[],
  languageByUserId: Map<string, PushLanguage>,
  message: MessageRecord,
  senderName: string
): Promise<DeliveryStats> {
  if (Deno.env.get("WEB_PUSH_ENABLED") !== "true") {
    return { sent: 0, removed: 0, failed: 0 };
  }

  const vapidKeysJson = Deno.env.get("WEB_PUSH_VAPID_KEYS");
  const vapidSubject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT");
  if (!vapidKeysJson || !vapidSubject) {
    throw new Error("Web Push VAPID secrets are not configured");
  }

  const vapidKeys = await importVapidKeys(JSON.parse(vapidKeysJson));
  const applicationServer = await ApplicationServer.new({
    contactInformation: vapidSubject,
    vapidKeys,
  });

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("web_push_subscriptions")
    .select("endpoint, p256dh, auth, user_id")
    .in("user_id", recipientIds);

  if (subscriptionsError) throw subscriptionsError;

  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const subscription of (subscriptions ?? []) as WebPushSubscriptionRecord[]) {
    const language = languageByUserId.get(subscription.user_id) ?? DEFAULT_LANGUAGE;
    const pushSubscription: WebPushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };

    try {
      await applicationServer
        .subscribe(pushSubscription)
        .pushTextMessage(
          JSON.stringify({
            title: senderName || PUSH_COPY[language].userFallback,
            body: getMessagePreview(message, language),
            data: {
              roomId: message.room_id,
              type: "message",
              messageId: message.id,
              createdAt: message.created_at,
            },
          }),
          {
            ttl: 60,
            urgency: Urgency.High,
          }
        );
      sent += 1;
    } catch (error) {
      if (isGoneWebPushError(error)) {
        const { error: cleanupError } = await supabase
          .from("web_push_subscriptions")
          .delete()
          .eq("endpoint", subscription.endpoint);

        if (cleanupError) {
          console.error("[send-push-on-message] web subscription cleanup", cleanupError);
        }
        removed += 1;
      } else {
        failed += 1;
        console.error("[send-push-on-message] web push delivery", error);
      }
    }
  }

  return { sent, removed, failed };
}

function normalizePayload(body: unknown): WebhookPayload | null {
  if (!body || typeof body !== "object") return null;

  const value = body as Record<string, unknown>;

  if (value.type && value.table && value.record) {
    return value as unknown as WebhookPayload;
  }

  if (value.record && typeof value.record === "object") {
    return {
      type: "INSERT",
      table: "messages",
      record: value.record as MessageRecord,
    };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Only the DB trigger (which reads the secret from Vault) may call this
  const expectedSecret = Deno.env.get("PUSH_FUNCTION_SECRET");
  if (!expectedSecret || req.headers.get("x-push-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const payload = normalizePayload(body);

    if (!payload || payload.type !== "INSERT" || payload.table !== "messages") {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Never trust the payload body: re-read the message from the database
    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("id, room_id, sender_id, content, type, media_url, created_at")
      .eq("id", payload.record.id)
      .maybeSingle();

    if (messageError) {
      throw messageError;
    }

    if (!message) {
      return new Response(JSON.stringify({ error: "Unknown message" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: sender, error: senderError } = await supabase
      .from("profiles")
      .select("display_name, username")
      .eq("id", message.sender_id)
      .single();

    if (senderError || !sender) {
      throw senderError ?? new Error("Sender profile not found");
    }

    const senderName =
      sender.display_name?.trim() || sender.username?.trim() || "";

    const { data: participants, error: participantsError } = await supabase
      .from("room_participants")
      .select("user_id")
      .eq("room_id", message.room_id)
      .neq("user_id", message.sender_id);

    if (participantsError) {
      throw participantsError;
    }

    const recipientIds = (participants ?? []).map((p) => p.user_id);

    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Each recipient gets push copy in their own preferred language
    const { data: recipientProfiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, preferred_language")
      .in("id", recipientIds);

    if (profilesError) {
      throw profilesError;
    }

    const languageByUserId = new Map<string, PushLanguage>(
      (recipientProfiles ?? []).map((profile) => [
        profile.id,
        resolveLanguage(profile.preferred_language),
      ])
    );

    // Keep Android and Web Push delivery independent. A provider outage on
    // one platform must never prevent the other platform from receiving a
    // notification or make the originating message insert look failed.
    const [androidResult, webResult] = await Promise.allSettled([
      sendAndroidPushNotifications(
        supabase,
        recipientIds,
        languageByUserId,
        message,
        senderName
      ),
      sendWebPushNotifications(
        supabase,
        recipientIds,
        languageByUserId,
        message,
        senderName
      ),
    ]);

    if (androidResult.status === "rejected") {
      console.error("[send-push-on-message] android delivery", androidResult.reason);
    }
    if (webResult.status === "rejected") {
      console.error("[send-push-on-message] web delivery", webResult.reason);
    }

    const android =
      androidResult.status === "fulfilled"
        ? androidResult.value
        : { sent: 0, removed: 0, failed: 1 };
    const web =
      webResult.status === "fulfilled"
        ? webResult.value
        : { sent: 0, removed: 0, failed: 1 };

    return new Response(
      JSON.stringify({
        sent: android.sent + web.sent,
        androidSent: android.sent,
        webSent: web.sent,
        removed: android.removed + web.removed,
        failed: android.failed + web.failed,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[send-push-on-message]", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});

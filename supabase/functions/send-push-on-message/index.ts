import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("token, user_id")
      .in("user_id", recipientIds)
      .eq("platform", "android");

    if (tokensError) {
      throw tokensError;
    }

    // Dedupe tokens while keeping each token's owner for language lookup
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

    // Send in chunks of 100 (Expo limit) and collect dead tokens from tickets
    const deadTokens: string[] = [];

    for (let i = 0; i < pushMessages.length; i += EXPO_PUSH_CHUNK_SIZE) {
      const chunk = pushMessages.slice(i, i + EXPO_PUSH_CHUNK_SIZE);
      const tickets = await sendExpoPushChunk(chunk);

      tickets.forEach((ticket, index) => {
        if (
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
        ) {
          deadTokens.push(chunk[index].to);
        }
      });
    }

    if (deadTokens.length > 0) {
      const { error: cleanupError } = await supabase
        .from("push_tokens")
        .delete()
        .in("token", deadTokens);

      if (cleanupError) {
        console.error("[send-push-on-message] token cleanup", cleanupError);
      }
    }

    return new Response(
      JSON.stringify({
        sent: pushMessages.length - deadTokens.length,
        removed: deadTokens.length,
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

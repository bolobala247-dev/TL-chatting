import type {
  CallLogMetadata,
  MessageAttachment,
  MessageWithMeta,
  PollMetadata,
} from "@/src/types";

// attachments is a jsonb column (Json | null) — narrow it to the album shape.
// Legacy single-image rows only have media_url, so fall back to that.
export function getAttachments(message: MessageWithMeta): MessageAttachment[] {
  const raw = message.attachments;
  if (Array.isArray(raw)) {
    return (raw as unknown[]).filter(
      (a): a is MessageAttachment =>
        !!a && typeof a === "object" && typeof (a as any).url === "string"
    );
  }
  if (message.media_url) return [{ url: message.media_url }];
  return [];
}

// metadata jsonb → immutable poll definition (null when malformed)
export function getPollMetadata(message: MessageWithMeta): PollMetadata | null {
  const raw = message.metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { question, options } = raw as Record<string, unknown>;
  if (typeof question !== "string" || !Array.isArray(options)) return null;
  return {
    question,
    options: options.filter((o): o is string => typeof o === "string"),
  };
}

// metadata jsonb → call-log payload (null when the row isn't a call log)
export function getCallMetadata(message: MessageWithMeta): CallLogMetadata | null {
  const raw = message.metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const call = (raw as Record<string, unknown>).call;
  if (!call || typeof call !== "object") return null;
  const { call_type, status, duration_seconds } = call as Record<string, unknown>;
  if (call_type !== "audio" && call_type !== "video") return null;
  return {
    call_id: String((call as any).call_id ?? ""),
    call_type,
    status: status as CallLogMetadata["status"],
    duration_seconds:
      typeof duration_seconds === "number" ? duration_seconds : null,
  };
}

// Seconds → "m:ss" (call duration + in-call timer)
export function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

import type { MessageAttachment, MessageWithMeta, PollMetadata } from "@/src/types";

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

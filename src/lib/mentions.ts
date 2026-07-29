import type { MessageMention, MessageWithMeta } from "@/src/types";

// Trailing "@token" the composer is currently typing (empty token = bare "@")
const MENTION_QUERY_RE = /(^|\s)@([a-zA-Z0-9._]*)$/;
// Every "@username" token inside a message body
const MENTION_TOKEN_RE = /@([a-zA-Z0-9._]+)/g;

// Autocomplete trigger: returns the username fragment after a trailing "@",
// or null when the caret is not inside a mention token.
export function getMentionQuery(text: string): string | null {
  const match = MENTION_QUERY_RE.exec(text);
  return match ? match[2] : null;
}

// Replace the trailing "@token" with the chosen "@username " (trailing space
// closes the token so autocomplete dismisses).
export function insertMention(text: string, username: string): string {
  return text.replace(MENTION_QUERY_RE, `$1@${username} `);
}

// Prune tracked mentions whose "@username" the user deleted before sending.
export function extractMentions(
  text: string,
  tracked: MessageMention[]
): MessageMention[] {
  const usernames = new Set(
    Array.from(text.matchAll(MENTION_TOKEN_RE), (m) => m[1].toLowerCase())
  );
  const seen = new Set<string>();
  return tracked.filter((m) => {
    if (!usernames.has(m.username.toLowerCase()) || seen.has(m.id)) {
      return false;
    }
    seen.add(m.id);
    return true;
  });
}

// metadata jsonb → tagged users (empty when absent/malformed)
export function getMentions(message: MessageWithMeta): MessageMention[] {
  const raw = message.metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const { mentions } = raw as Record<string, unknown>;
  if (!Array.isArray(mentions)) return [];
  return (mentions as unknown[]).filter(
    (m): m is MessageMention =>
      !!m &&
      typeof m === "object" &&
      typeof (m as any).id === "string" &&
      typeof (m as any).username === "string"
  );
}

// Segment a message body into plain-text / mention runs for the bubble.
export function splitByMentions(
  content: string,
  mentions: MessageMention[]
): { text: string; isMention: boolean }[] {
  if (mentions.length === 0) return [{ text: content, isMention: false }];

  const usernames = new Set(mentions.map((m) => m.username.toLowerCase()));
  const segments: { text: string; isMention: boolean }[] = [];
  let last = 0;

  for (const match of content.matchAll(MENTION_TOKEN_RE)) {
    if (!usernames.has(match[1].toLowerCase())) continue;
    const start = match.index ?? 0;
    if (start > last) {
      segments.push({ text: content.slice(last, start), isMention: false });
    }
    segments.push({ text: match[0], isMention: true });
    last = start + match[0].length;
  }

  if (last < content.length) {
    segments.push({ text: content.slice(last), isMention: false });
  }
  return segments;
}

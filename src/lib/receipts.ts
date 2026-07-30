import type { RoomParticipantWithProfile } from "@/src/types";

// Read receipts derive from the room_participants.last_read_at watermark:
// a participant has seen a message iff their watermark is at or past the
// message's creation time (no per-message receipt writes).
export function hasSeen(
  participant: RoomParticipantWithProfile,
  messageCreatedAt: string | null
): boolean {
  if (!messageCreatedAt || !participant.last_read_at) return false;
  return new Date(participant.last_read_at) >= new Date(messageCreatedAt);
}

// Collapse the other participants' watermarks into a single cutoff: the
// earliest last_read_at, or null when someone has never read (or there is
// nobody else). A stable string keeps memoized bubbles from re-rendering
// on participant array identity changes.
export function getSeenWatermark(
  participants: RoomParticipantWithProfile[],
  excludeUserId?: string | null
): string | null {
  let min: string | null = null;
  let hasOthers = false;
  for (const p of participants) {
    if (p.user_id === excludeUserId) continue;
    hasOthers = true;
    if (!p.last_read_at) return null;
    if (min === null || new Date(p.last_read_at) < new Date(min)) {
      min = p.last_read_at;
    }
  }
  return hasOthers ? min : null;
}

// A message is seen by all iff every other watermark is at or past its
// creation time — i.e. the collapsed cutoff is.
export function seenByAllAt(
  seenWatermark: string | null | undefined,
  messageCreatedAt: string | null
): boolean {
  if (!seenWatermark || !messageCreatedAt) return false;
  return new Date(seenWatermark) >= new Date(messageCreatedAt);
}

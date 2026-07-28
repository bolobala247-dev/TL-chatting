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

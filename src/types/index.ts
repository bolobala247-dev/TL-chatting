import type { Database } from "./database";

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type InsertTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type UpdateTables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Profile = Tables<"profiles">;
export type Room = Tables<"rooms">;
export type RoomParticipant = Tables<"room_participants">;
export type Message = Tables<"messages">;
export type PushToken = Tables<"push_tokens">;
export type SavedMessage = Tables<"saved_messages">;
export type ScheduledMessage = Tables<"scheduled_messages">;
export type MessageReaction = Tables<"message_reactions">;
export type PollVote = Tables<"poll_votes">;

// One image inside a multi-attachment (album) message.
export interface MessageAttachment {
  url: string;
  width?: number;
  height?: number;
}

// Immutable poll definition stored on messages.metadata.
export interface PollMetadata {
  question: string;
  options: string[];
}

// A message carrying its embedded reactions + poll votes (from getMessages).
// chatStore holds messages in this shape.
export type MessageWithMeta = Message & {
  message_reactions?: Pick<MessageReaction, "user_id" | "emoji">[];
  poll_votes?: Pick<PollVote, "user_id" | "option_index">[];
};

export interface RoomWithLastMessage {
  room_id: string;
  room_type: string;
  room_name: string | null;
  room_avatar: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender: string | null;
  last_message_type: string | null;
  unread_count: number;
}

export interface MessageWithSender extends Message {
  sender?: Profile;
}

// Participant row with the joined profile (header, read receipts)
export type RoomParticipantWithProfile = RoomParticipant & {
  profiles: Profile | null;
};

// Shape returned by savedMessageService.getSavedMessages (nested embeds)
export interface SavedMessageItem {
  id: string;
  created_at: string | null;
  message: Message & {
    sender: Pick<Profile, "id" | "username" | "display_name" | "avatar_url"> | null;
    room: Pick<Room, "id" | "name" | "type"> | null;
  };
}

// Query lanes of the shared-media screen
export type MediaKind = "media" | "file" | "link";

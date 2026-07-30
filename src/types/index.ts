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
export type PrivacySettings = Tables<"privacy_settings">;
export type UserPresence = Tables<"user_presence">;
export type RoomRead = Tables<"room_reads">;
export type UserBlock = Tables<"user_blocks">;
export type UserReport = Tables<"user_reports">;
export type Call = Tables<"calls">;

// Call lifecycle (calls.type / calls.status CHECK constraints)
export type CallType = "audio" | "video";
export type CallStatus = "ringing" | "answered" | "declined" | "missed" | "ended";

// Call-log payload stored on messages.metadata.call (type = "call")
export interface CallLogMetadata {
  call_id: string;
  call_type: CallType;
  status: Extract<CallStatus, "declined" | "missed" | "ended">;
  duration_seconds: number | null;
}

// Privacy visibility levels (privacy_settings CHECK constraints)
export type VisibilityLevel = "everyone" | "contacts" | "nobody";
export type AvatarVisibility = "everyone" | "contacts";
export type PhoneVisibility = "contacts" | "nobody";

// Report reasons accepted by submit_report RPC
export type ReportReason = "spam" | "harassment" | "hate" | "scam" | "other";

// Shape returned by get_peer_profile RPC (privacy-gated peer view).
// Generated Functions types lose nullability for RETURNS TABLE, so kept explicit.
export interface PeerProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  phone_number: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  is_blocked_by_me: boolean;
}

// Shape returned by get_blocked_profiles RPC
export interface BlockedProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  blocked_at: string;
}

// Shape returned by search_profiles RPC (avatar already privacy-masked)
export interface ProfileSearchResult {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

// Message lanes accepted by the search_messages RPC
export type MessageSearchKind = "message" | "image" | "file" | "link";

// Shape returned by search_messages RPC.
// Generated Functions types lose nullability for RETURNS TABLE, so kept explicit.
export interface MessageSearchResult {
  id: string;
  room_id: string;
  sender_id: string | null;
  content: string | null;
  type: string;
  media_url: string | null;
  attachments: Message["attachments"];
  created_at: string;
  sender_name: string | null;
  sender_avatar: string | null;
  room_name: string | null;
  room_type: string;
}

// One user tagged in a message, stored on messages.metadata.mentions.
export interface MessageMention {
  id: string;
  username: string;
  display_name: string;
}

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
  bookmarked_at: string | null;
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

// Incremental-sync cursor for one scope (a room id, or ROOMS_SYNC_SCOPE for
// the room list). Local-cache domain type — persisted only in SQLite.
export interface SyncState {
  scope_id: string;
  last_synced_at: string | null;
  has_full_history: boolean;
  stale: boolean;
}

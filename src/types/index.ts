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

// ---------------------------------------------------------------------------
// Local search index (Phase 8A/8B) — a DERIVED projection of `messages`.
// These types never touch the wire or database.ts; they describe the local
// FTS5 cache only. Messages remain the single source of truth (§18).
// ---------------------------------------------------------------------------

// One message flattened into the searchable projection (search_index row).
// Built by the pure `buildSearchDoc` helper from a MessageWithMeta.
export interface SearchDoc {
  message_id: string;
  room_id: string;
  sender_id: string | null;
  type: string;
  has_link: boolean;
  // Date.parse(created_at) — integer recency ranking + sort key.
  created_ms: number;
  // ISO created_at — pagination cursor (parity with the RPC's p_before).
  created_at: string;
  // FTS column 0 (message body).
  text: string | null;
  // FTS column 1 (attachment filenames + kind keyword + link hosts).
  media_text: string | null;
}

// A matched span within a plain-text string (highlight side-channel, §9).
export interface MatchRange {
  start: number;
  length: number;
}

// Which local path served a query (tapped as search.path, §15). 'fts' = ranked
// MATCH; 'like' = short-query/no-FTS substring scan; 'empty' = media-lane browse.
export type SearchPath = "fts" | "like" | "empty";

// A resolved search request handed to SearchRepository.search. A superset of
// the RPC arguments plus the ranking policy (weights/snippet width) the
// service injects — the repo owns SQL/FTS, never the policy numbers (§4/§8).
export interface SearchQuery {
  query: string;
  kind: MessageSearchKind;
  roomId?: string;
  before?: string;
  limit: number;
  weights: { bm25: number; recency: number; room: number };
  snippetTokens: number;
  minTokenLen: number;
}

// One index-local hit. Display fields (content/media_url/attachments) come from
// a JOIN back to `messages` in the search SQL — the index locates WHICH row
// matched; `messages` supplies what to show (reinforcing source-of-truth).
export interface SearchHit {
  message_id: string;
  room_id: string;
  sender_id: string | null;
  content: string | null;
  type: string;
  media_url: string | null;
  attachments: Message["attachments"];
  created_at: string;
  // Blended rank (lower = better); ordering is done in SQL, this is for taps.
  score: number;
  // FTS snippet() excerpt, or null on the like/browse path (service synthesizes).
  snippet: string | null;
  // highlight() output delimited with U+0002/U+0003 around matched terms, or
  // null off the FTS path; searchService converts it to MatchRange[].
  highlight: string | null;
}

// SearchRepository.search result: the ranked hits plus which path produced them
// (so searchService can tap search.path without re-deriving the decision).
export interface SearchResultSet {
  hits: SearchHit[];
  path: SearchPath;
}

// One user tagged in a message, stored on messages.metadata.mentions.
export interface MessageMention {
  id: string;
  username: string;
  display_name: string;
}

// One image inside a multi-attachment (album) message.
// Phase 7A/7B media pipeline: extended additively — every new field is
// optional, so legacy rows ({url,width,height}) parse and render unchanged.
export interface MessageAttachment {
  url: string;
  width?: number;
  height?: number;
  /** 'image' | 'video' | 'file' — absent = image (legacy rows). */
  kind?: MediaAttachmentKind;
  /** base64 data-URI micro thumbnail (~32px JPEG) for progressive loading. */
  thumb?: string;
  /** Staged (post-compression) byte size. */
  bytes?: number;
  mime?: string;
  /** Original filename (kind='file'). */
  name?: string;
  /** Playback length (kind='video'). */
  duration_ms?: number;
}

// Attachment kinds carried by the media pipeline (upload_queue.kind).
export type MediaAttachmentKind = "image" | "video" | "file";

// upload_queue.state lifecycle (Phase 7A §3.2).
export type UploadTaskState = "queued" | "uploading" | "uploaded" | "failed";

// One upload_queue row (domain-mapped) — the unit of upload work, retry,
// and progress. The owning media message is a real `messages` row
// (status='pending'); these rows are the binary work list only.
export interface UploadTask {
  id: string;
  message_id: string;
  room_id: string;
  position: number;
  kind: MediaAttachmentKind;
  local_uri: string;
  mime: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  thumb: string | null;
  remote_path: string | null;
  remote_url: string | null;
  state: UploadTaskState;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string | null;
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
  // Offline outbox (Phase 5A): client-only render annotation for an outgoing
  // message's send state — absent = normal/sent. Never sent to the server,
  // never in database.ts; maps to/from the SQLite messages.status column.
  outbox_status?: "pending" | "failed";
};

// One queued outgoing message + its outbox bookkeeping (Phase 5A). The
// message itself is a real `messages` row (status='pending'|'failed'); the
// outbox row is the thin queue index the worker enumerates.
export interface OutboxItem {
  message: MessageWithMeta;
  attempts: number;
  next_attempt_at: string | null;
  state: "pending" | "failed";
}

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

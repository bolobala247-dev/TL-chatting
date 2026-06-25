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

export interface RoomWithLastMessage {
  room_id: string;
  room_type: string;
  room_name: string | null;
  room_avatar: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender: string | null;
  unread_count: number;
}

export interface MessageWithSender extends Message {
  sender?: Profile;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          avatar_url: string | null;
          status: string;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          avatar_url?: string | null;
          status?: string;
          last_seen_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          status?: string;
          last_seen_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          type: string;
          name: string | null;
          avatar_url: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          name?: string | null;
          avatar_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          name?: string | null;
          avatar_url?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      room_participants: {
        Row: {
          id: string;
          room_id: string;
          user_id: string;
          role: string;
          joined_at: string;
          last_read_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          user_id: string;
          role?: string;
          joined_at?: string;
          last_read_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          user_id?: string;
          role?: string;
          joined_at?: string;
          last_read_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          room_id: string;
          sender_id: string;
          content: string | null;
          type: string;
          media_url: string | null;
          reply_to: string | null;
          is_edited: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          sender_id: string;
          content?: string | null;
          type?: string;
          media_url?: string | null;
          reply_to?: string | null;
          is_edited?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          room_id?: string;
          sender_id?: string;
          content?: string | null;
          type?: string;
          media_url?: string | null;
          reply_to?: string | null;
          is_edited?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_rooms: {
        Args: { p_user_id: string };
        Returns: {
          room_id: string;
          room_type: string;
          room_name: string | null;
          room_avatar: string | null;
          last_message_content: string | null;
          last_message_at: string | null;
          last_message_sender: string | null;
          unread_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

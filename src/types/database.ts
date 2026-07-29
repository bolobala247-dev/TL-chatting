export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      message_reactions: {
        Row: {
          created_at: string | null
          emoji: string
          id: string
          message_id: string
          room_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          emoji: string
          id?: string
          message_id: string
          room_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          emoji?: string
          id?: string
          message_id?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json | null
          content: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          has_link: boolean | null
          id: string
          is_edited: boolean | null
          media_url: string | null
          metadata: Json | null
          pinned_at: string | null
          pinned_by: string | null
          reply_to: string | null
          room_id: string
          sender_id: string
          thread_id: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          attachments?: Json | null
          content?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          has_link?: boolean | null
          id?: string
          is_edited?: boolean | null
          media_url?: string | null
          metadata?: Json | null
          pinned_at?: string | null
          pinned_by?: string | null
          reply_to?: string | null
          room_id: string
          sender_id: string
          thread_id?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          attachments?: Json | null
          content?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          has_link?: boolean | null
          id?: string
          is_edited?: boolean | null
          media_url?: string | null
          metadata?: Json | null
          pinned_at?: string | null
          pinned_by?: string | null
          reply_to?: string | null
          room_id?: string
          sender_id?: string
          thread_id?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_pinned_by_fkey"
            columns: ["pinned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_votes: {
        Row: {
          created_at: string | null
          id: string
          message_id: string
          option_index: number
          room_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_id: string
          option_index: number
          room_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_id?: string
          option_index?: number
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_settings: {
        Row: {
          avatar_visibility: string
          last_seen_visibility: string
          online_visibility: string
          phone_number: string | null
          phone_visibility: string
          read_receipts_enabled: boolean
          typing_indicators_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_visibility?: string
          last_seen_visibility?: string
          online_visibility?: string
          phone_number?: string | null
          phone_visibility?: string
          read_receipts_enabled?: boolean
          typing_indicators_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_visibility?: string
          last_seen_visibility?: string
          online_visibility?: string
          phone_number?: string | null
          phone_visibility?: string
          read_receipts_enabled?: boolean
          typing_indicators_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "privacy_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          id: string
          last_seen_at: string | null
          preferred_language: string | null
          status: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id: string
          last_seen_at?: string | null
          preferred_language?: string | null
          status?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string
          last_seen_at?: string | null
          preferred_language?: string | null
          status?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          device_id: string | null
          id: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          device_id?: string | null
          id?: string
          platform: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          device_id?: string | null
          id?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      room_participants: {
        Row: {
          bookmarked_at: string | null
          id: string
          joined_at: string | null
          last_read_at: string | null
          role: string | null
          room_id: string
          user_id: string
        }
        Insert: {
          bookmarked_at?: string | null
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string | null
          room_id: string
          user_id: string
        }
        Update: {
          bookmarked_at?: string | null
          id?: string
          joined_at?: string | null
          last_read_at?: string | null
          role?: string | null
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_reads: {
        Row: {
          last_read_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_reads_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string | null
          id: string
          name: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_messages: {
        Row: {
          created_at: string | null
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_messages_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          reply_to: string | null
          room_id: string
          scheduled_at: string
          sender_id: string
          sent_message_id: string | null
          status: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          reply_to?: string | null
          room_id: string
          scheduled_at: string
          sender_id: string
          sent_message_id?: string | null
          status?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          reply_to?: string | null
          room_id?: string
          scheduled_at?: string
          sender_id?: string
          sent_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_messages_sent_message_id_fkey"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          last_active_at: string
          user_id: string
        }
        Insert: {
          last_active_at?: string
          user_id: string
        }
        Update: {
          last_active_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          message_id: string | null
          message_snapshot: string | null
          reason: string
          reported_user_id: string
          reporter_id: string
          room_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          message_id?: string | null
          message_snapshot?: string | null
          reason: string
          reported_user_id: string
          reporter_id: string
          room_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          message_id?: string | null
          message_snapshot?: string | null
          reason?: string
          reported_user_id?: string
          reporter_id?: string
          room_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reports_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_blocked_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          blocked_at: string
          display_name: string
          id: string
          username: string
        }[]
      }
      get_email_by_username: { Args: { p_username: string }; Returns: string }
      get_my_room_ids: { Args: never; Returns: string[] }
      get_peer_profile: {
        Args: { p_user_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          is_blocked_by_me: boolean
          is_online: boolean
          last_seen_at: string
          phone_number: string
          username: string
        }[]
      }
      get_user_rooms: {
        Args: { p_user_id: string }
        Returns: {
          bookmarked_at: string
          last_message_at: string
          last_message_content: string
          last_message_sender: string
          last_message_type: string
          room_avatar: string
          room_id: string
          room_name: string
          room_type: string
          unread_count: number
        }[]
      }
      is_blocked_with: { Args: { p_user_id: string }; Returns: boolean }
      is_dm_blocked: { Args: { p_room_id: string }; Returns: boolean }
      is_dm_peer_blocked: {
        Args: { p_room_id: string; p_user_id: string }
        Returns: boolean
      }
      is_room_admin: { Args: { p_room_id: string }; Returns: boolean }
      is_room_creator: { Args: { p_room_id: string }; Returns: boolean }
      is_username_available: { Args: { p_username: string }; Returns: boolean }
      mark_room_read: { Args: { p_room_id: string }; Returns: undefined }
      process_scheduled_messages: { Args: never; Returns: undefined }
      search_messages: {
        Args: {
          p_before?: string
          p_kind?: string
          p_limit?: number
          p_query: string
          p_room_id?: string
        }
        Returns: {
          attachments: Json
          content: string
          created_at: string
          id: string
          media_url: string
          room_id: string
          room_name: string
          room_type: string
          sender_avatar: string
          sender_id: string
          sender_name: string
          type: string
        }[]
      }
      search_profiles: {
        Args: { p_query: string }
        Returns: {
          avatar_url: string
          display_name: string
          id: string
          username: string
        }[]
      }
      set_message_pin: {
        Args: { p_message_id: string; p_pinned: boolean }
        Returns: {
          attachments: Json | null
          content: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          has_link: boolean | null
          id: string
          is_edited: boolean | null
          media_url: string | null
          metadata: Json | null
          pinned_at: string | null
          pinned_by: string | null
          reply_to: string | null
          room_id: string
          sender_id: string
          thread_id: string | null
          type: string | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      shares_room_with: { Args: { p_user_id: string }; Returns: boolean }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_report: {
        Args: {
          p_details?: string
          p_message_id?: string
          p_reason: string
          p_reported_user_id: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

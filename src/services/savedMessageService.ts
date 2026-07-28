import { supabase } from "@/src/lib/supabase";
import { MESSAGES_PER_PAGE } from "@/src/lib/constants";
import type { SavedMessage, SavedMessageItem } from "@/src/types";

export const savedMessageService = {
  // Ids only — powers the save/unsave toggle in the message action sheet
  async getSavedIdsForRoom(roomId: string): Promise<Set<string>> {
    const { data, error } = await supabase
      .from("saved_messages")
      .select("message_id, messages!inner(room_id)")
      .eq("messages.room_id", roomId);

    if (error) throw error;
    return new Set((data ?? []).map((row) => row.message_id));
  },

  async save(userId: string, messageId: string): Promise<SavedMessage> {
    const { data, error } = await supabase
      .from("saved_messages")
      .insert({ user_id: userId, message_id: messageId })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // RLS limits the delete to the caller's own bookmark
  async unsave(messageId: string): Promise<void> {
    const { error } = await supabase
      .from("saved_messages")
      .delete()
      .eq("message_id", messageId);

    if (error) throw error;
  },

  async getSavedMessages(cursor?: string): Promise<SavedMessageItem[]> {
    // sender needs an FK hint: messages has several FKs to profiles
    let query = supabase
      .from("saved_messages")
      .select(
        `id, created_at,
         message:messages(
           *,
           sender:profiles!messages_sender_id_fkey(id, username, display_name, avatar_url),
           room:rooms(id, name, type)
         )`
      )
      .order("created_at", { ascending: false })
      .limit(MESSAGES_PER_PAGE);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as SavedMessageItem[];
  },
};

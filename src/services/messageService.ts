import { supabase } from "@/src/lib/supabase";
import { MESSAGES_PER_PAGE } from "@/src/lib/constants";
import type { Message, InsertTables } from "@/src/types";

export const messageService = {
  async getMessages(
    roomId: string,
    cursor?: string
  ): Promise<Message[]> {
    let query = supabase
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(MESSAGES_PER_PAGE);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async sendMessage(
    message: InsertTables<"messages">
  ): Promise<Message> {
    const { data, error } = await supabase
      .from("messages")
      .insert(message)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateMessage(
    messageId: string,
    content: string
  ): Promise<Message> {
    const { data, error } = await supabase
      .from("messages")
      .update({
        content,
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteMessage(messageId: string): Promise<void> {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (error) throw error;
  },

  async sendImageMessage(
    roomId: string,
    senderId: string,
    imageUri: string
  ): Promise<Message> {
    const fileName = `${roomId}/${Date.now()}.jpg`;
    const response = await fetch(imageUri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(fileName, blob, {
        contentType: "image/jpeg",
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from("chat-media").getPublicUrl(fileName);

    return this.sendMessage({
      room_id: roomId,
      sender_id: senderId,
      type: "image",
      media_url: publicUrl,
    });
  },
};

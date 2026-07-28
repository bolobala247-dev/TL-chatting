import { supabase } from "@/src/lib/supabase";
import {
  MESSAGES_PER_PAGE,
  MEDIA_PER_PAGE,
  PINNED_MESSAGES_LIMIT,
} from "@/src/lib/constants";
import type { Message, MediaKind, InsertTables } from "@/src/types";

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

  // Soft delete (recall): everyone sees a tombstone, content is wiped server-side
  async deleteForEveryone(
    messageId: string,
    userId: string
  ): Promise<Message> {
    const { data, error } = await supabase
      .from("messages")
      .update({
        content: null,
        media_url: null,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        pinned_at: null,
        pinned_by: null,
      })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Pin/unpin goes through an RPC so any participant (not just the sender) can do it
  async setPinned(messageId: string, pinned: boolean): Promise<Message> {
    const { data, error } = await supabase.rpc("set_message_pin", {
      p_message_id: messageId,
      p_pinned: pinned,
    });

    if (error) throw error;
    return data;
  },

  async getPinnedMessages(roomId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .not("pinned_at", "is", null)
      .order("pinned_at", { ascending: false })
      .limit(PINNED_MESSAGES_LIMIT);

    if (error) throw error;
    return data ?? [];
  },

  // Shared-media lanes; each is backed by a partial index (00008)
  async getMediaMessages(
    roomId: string,
    kind: MediaKind,
    cursor?: string
  ): Promise<Message[]> {
    let query = supabase
      .from("messages")
      .select("*")
      .eq("room_id", roomId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(MEDIA_PER_PAGE);

    if (kind === "media") {
      query = query.in("type", ["image", "video"]);
    } else if (kind === "file") {
      query = query.eq("type", "file");
    } else {
      query = query.eq("has_link", true);
    }

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
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

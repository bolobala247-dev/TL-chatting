import { supabase } from "@/src/lib/supabase";
import {
  MESSAGES_PER_PAGE,
  MEDIA_PER_PAGE,
  PINNED_MESSAGES_LIMIT,
} from "@/src/lib/constants";
import type {
  Message,
  MessageWithMeta,
  MessageAttachment,
  MediaKind,
  InsertTables,
} from "@/src/types";

// Reactions + poll votes ride along in the same query (no extra round trips)
const MESSAGE_WITH_META_SELECT =
  "*, message_reactions(user_id, emoji), poll_votes(user_id, option_index)";

export const messageService = {
  async getMessages(
    roomId: string,
    cursor?: string
  ): Promise<MessageWithMeta[]> {
    let query = supabase
      .from("messages")
      .select(MESSAGE_WITH_META_SELECT)
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

  // Thread = root message + all replies carrying its thread_id
  // (flat, index-backed by idx_messages_thread). Oldest first.
  async getThreadMessages(rootId: string): Promise<MessageWithMeta[]> {
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_WITH_META_SELECT)
      .or(`id.eq.${rootId},thread_id.eq.${rootId}`)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  },

  async sendImageMessage(
    roomId: string,
    senderId: string,
    imageUri: string
  ): Promise<Message> {
    const fileName = `${roomId}/${Date.now()}.jpg`;
    // RN không hỗ trợ tạo Blob từ ArrayBuffer — upload ArrayBuffer trực tiếp
    const response = await fetch(imageUri);
    const arrayBuffer = await response.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(fileName, arrayBuffer, {
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

  // Album: parallel uploads, then ONE message row (one list item, one push)
  async sendAlbumMessage(
    roomId: string,
    senderId: string,
    imageUris: string[],
    caption?: string
  ): Promise<Message> {
    const ts = Date.now();

    const urls = await Promise.all(
      imageUris.map(async (uri, i) => {
        const fileName = `${roomId}/${ts}-${i}.jpg`;
        const response = await fetch(uri);
        const arrayBuffer = await response.arrayBuffer();

        const { error: uploadError } = await supabase.storage
          .from("chat-media")
          .upload(fileName, arrayBuffer, { contentType: "image/jpeg" });

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from("chat-media").getPublicUrl(fileName);
        return publicUrl;
      })
    );

    const attachments: MessageAttachment[] = urls.map((url) => ({ url }));

    return this.sendMessage({
      room_id: roomId,
      sender_id: senderId,
      type: "image",
      content: caption?.trim() || null,
      // media_url = first image for backward compat (old clients, media lanes)
      media_url: urls[0],
      attachments: attachments as any,
    });
  },

  // Poll definition is immutable, so it lives on the message itself.
  // content mirrors the question so previews and push notifications work.
  async sendPollMessage(
    roomId: string,
    senderId: string,
    question: string,
    options: string[]
  ): Promise<Message> {
    return this.sendMessage({
      room_id: roomId,
      sender_id: senderId,
      type: "poll",
      content: question.trim(),
      metadata: { question: question.trim(), options } as any,
    });
  },
};

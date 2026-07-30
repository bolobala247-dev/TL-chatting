import { supabase } from "@/src/lib/supabase";
import {
  MESSAGES_PER_PAGE,
  MEDIA_PER_PAGE,
  PINNED_MESSAGES_LIMIT,
  DELTA_SYNC_LIMIT,
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

// Public URL → object path inside the chat-media bucket (for storage.remove)
const CHAT_MEDIA_URL_MARKER = "/object/public/chat-media/";

function collectChatMediaPaths(
  message: Pick<Message, "media_url" | "attachments">
): string[] {
  const urls = new Set<string>();
  if (message.media_url) urls.add(message.media_url);
  const attachments =
    (message.attachments as MessageAttachment[] | null) ?? [];
  for (const att of attachments) {
    if (att?.url) urls.add(att.url);
  }

  const paths: string[] = [];
  for (const url of urls) {
    const idx = url.indexOf(CHAT_MEDIA_URL_MARKER);
    if (idx !== -1) {
      paths.push(
        decodeURIComponent(url.slice(idx + CHAT_MEDIA_URL_MARKER.length))
      );
    }
  }
  return paths;
}

// Best effort — an orphaned file only wastes storage, never block the UX flow
async function removeChatMediaObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from("chat-media").remove(paths);
  if (error) console.error("[messageService] remove chat-media", error);
}

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

  // Incremental delta (Phase 4, §17 C3): messages of a room touched since a
  // server `updated_at` high-water-mark. Plain PostgREST select (not an RPC)
  // so the existing reaction/vote embeds ride along and no type regen is
  // needed. Ordered ASC by updated_at so the caller can advance the cursor to
  // the last row; `limit` caps the window and drives the gap-overflow guard.
  async getRoomMessagesSince(
    roomId: string,
    since: string,
    limit: number = DELTA_SYNC_LIMIT
  ): Promise<MessageWithMeta[]> {
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_WITH_META_SELECT)
      .eq("room_id", roomId)
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(limit);

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

  // Idempotent send (Phase 5A, §4.1): insert-or-return keyed on the CLIENT-minted
  // message id (a v4 UUID = the idempotency key). A retried send of the same id
  // returns the existing row instead of duplicating it (server PK + ON CONFLICT
  // DO NOTHING), so missed-ACK re-drives are safe (Invariants #6/#7). sender_id is
  // forced to auth.uid() inside the RPC — the client can never spoof a sender.
  // Additive: coexists with the plain-insert sendMessage used by the flag-off path.
  async sendMessageIdempotent(payload: {
    id: string;
    room_id: string;
    content: string;
    type: string;
    metadata?: Message["metadata"];
    reply_to?: string | null;
    created_at: string;
  }): Promise<Message> {
    const { data, error } = await supabase.rpc("send_message_idempotent", {
      p_id: payload.id,
      p_room_id: payload.room_id,
      p_content: payload.content,
      p_type: payload.type,
      p_metadata: payload.metadata ?? undefined,
      p_reply_to: payload.reply_to ?? undefined,
      p_created_at: payload.created_at,
    });

    if (error) throw error;
    // SETOF messages → always returns the (new or pre-existing) row.
    const row = data?.[0];
    if (!row) throw new Error("send_message_idempotent returned no row");
    return row;
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

  // Soft delete (recall): everyone sees a tombstone, content is wiped server-side.
  // Takes the full message so the underlying chat-media files can be cleaned up.
  async deleteForEveryone(
    message: Message,
    userId: string
  ): Promise<Message> {
    const { data, error } = await supabase
      .from("messages")
      .update({
        content: null,
        media_url: null,
        attachments: null,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        pinned_at: null,
        pinned_by: null,
      })
      .eq("id", message.id)
      .select()
      .single();

    if (error) throw error;

    // Free the storage objects the tombstone no longer references
    void removeChatMediaObjects(collectChatMediaPaths(message));

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

import { supabase } from "@/src/lib/supabase";
import type {
  Room,
  RoomWithLastMessage,
  RoomParticipantWithProfile,
} from "@/src/types";

export const roomService = {
  async getUserRooms(userId: string): Promise<RoomWithLastMessage[]> {
    const { data, error } = await supabase.rpc("get_user_rooms", {
      p_user_id: userId,
    });

    if (error) throw error;
    return data ?? [];
  },

  async createDirectRoom(
    currentUserId: string,
    otherUserId: string
  ): Promise<Room> {
    const existing = await this.findDirectRoom(currentUserId, otherUserId);
    if (existing) return existing;

    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({ type: "direct", created_by: currentUserId })
      .select()
      .single();

    if (roomError) throw roomError;

    const { error: participantsError } = await supabase
      .from("room_participants")
      .insert([
        { room_id: room.id, user_id: currentUserId, role: "admin" },
        { room_id: room.id, user_id: otherUserId, role: "member" },
      ]);

    if (participantsError) throw participantsError;

    return room;
  },

  async createGroupRoom(
    currentUserId: string,
    name: string,
    memberIds: string[]
  ): Promise<Room> {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({ type: "group", name, created_by: currentUserId })
      .select()
      .single();

    if (roomError) throw roomError;

    const participants = [
      { room_id: room.id, user_id: currentUserId, role: "admin" as const },
      ...memberIds.map((id) => ({
        room_id: room.id,
        user_id: id,
        role: "member" as const,
      })),
    ];

    const { error: participantsError } = await supabase
      .from("room_participants")
      .insert(participants);

    if (participantsError) throw participantsError;

    return room;
  },

  // Room row: type ("direct"/"group") + group name/avatar for the header
  async getRoom(roomId: string): Promise<Room> {
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error) throw error;
    return data;
  },

  // Group info edit — RLS only allows group admins
  async updateGroupRoom(
    roomId: string,
    updates: { name?: string; avatar_url?: string }
  ): Promise<Room> {
    const { data, error } = await supabase
      .from("rooms")
      .update(updates)
      .eq("id", roomId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Group avatar lives in chat-media under the room's folder
  // (storage RLS: only participants may write to {roomId}/)
  async uploadGroupAvatar(roomId: string, uri: string): Promise<string> {
    const fileName = `${roomId}/avatar_${Date.now()}.jpg`;
    // RN không hỗ trợ tạo Blob từ ArrayBuffer — upload ArrayBuffer trực tiếp
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(fileName, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from("chat-media").getPublicUrl(fileName);

    // Old avatar_* files pile up next to chat media — sweep only that prefix
    // so message attachments are untouched (best effort, never block)
    try {
      const { data: existing } = await supabase.storage
        .from("chat-media")
        .list(roomId);
      const stale = (existing ?? [])
        .filter(
          (f) =>
            f.name.startsWith("avatar_") && `${roomId}/${f.name}` !== fileName
        )
        .map((f) => `${roomId}/${f.name}`);
      if (stale.length > 0) {
        await supabase.storage.from("chat-media").remove(stale);
      }
    } catch (err) {
      console.error("[roomService] cleanup old group avatars", err);
    }

    return publicUrl;
  },

  async findDirectRoom(
    userId1: string,
    userId2: string
  ): Promise<Room | null> {
    // Both memberships filtered server-side via aliased !inner embeds:
    // one round trip instead of fetching every direct room (with all
    // participants) and scanning client-side
    const { data } = await supabase
      .from("rooms")
      .select(
        "*, mine:room_participants!inner(user_id), theirs:room_participants!inner(user_id)"
      )
      .eq("type", "direct")
      .eq("mine.user_id", userId1)
      .eq("theirs.user_id", userId2)
      .limit(1);

    const room = data?.[0];
    if (!room) return null;

    const { mine: _m, theirs: _t, ...roomWithout } = room as any;
    return roomWithout as Room;
  },

  async getRoomParticipants(
    roomId: string
  ): Promise<RoomParticipantWithProfile[]> {
    const { data, error } = await supabase
      .from("room_participants")
      .select("*, profiles(*)")
      .eq("room_id", roomId);

    if (error) throw error;
    return (data ?? []) as any;
  },

  async updateLastRead(roomId: string, _userId: string) {
    // RPC always updates the private room_reads watermark; the public
    // room_participants.last_read_at mirror only moves when the user
    // has read receipts enabled (privacy_settings.read_receipts_enabled).
    const { error } = await supabase.rpc("mark_room_read", {
      p_room_id: roomId,
    });

    if (error) throw error;
  },

  // Conversation bookmark: per-user pin on the own participant row
  // (participants_update RLS: auth.uid() = user_id)
  async setRoomBookmark(
    roomId: string,
    userId: string,
    bookmarked: boolean
  ): Promise<string | null> {
    const bookmarkedAt = bookmarked ? new Date().toISOString() : null;

    const { error } = await supabase
      .from("room_participants")
      .update({ bookmarked_at: bookmarkedAt })
      .eq("room_id", roomId)
      .eq("user_id", userId);

    if (error) throw error;
    return bookmarkedAt;
  },
};

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

    return publicUrl;
  },

  async findDirectRoom(
    userId1: string,
    userId2: string
  ): Promise<Room | null> {
    const { data } = await supabase
      .from("room_participants")
      .select("room_id")
      .eq("user_id", userId1);

    if (!data?.length) return null;

    const roomIds = data.map((p) => p.room_id);

    const { data: rooms } = await supabase
      .from("rooms")
      .select("*, room_participants!inner(*)")
      .in("id", roomIds)
      .eq("type", "direct");

    if (!rooms) return null;

    for (const room of rooms) {
      const participants = (room as any).room_participants as Array<{
        user_id: string;
      }>;
      const hasOtherUser = participants.some((p) => p.user_id === userId2);
      if (hasOtherUser) {
        const { room_participants: _, ...roomWithout } = room as any;
        return roomWithout;
      }
    }

    return null;
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

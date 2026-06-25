import { supabase } from "@/src/lib/supabase";
import type { Room, RoomWithLastMessage, RoomParticipant, Profile } from "@/src/types";

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
  ): Promise<Array<RoomParticipant & { profiles: Profile | null }>> {
    const { data, error } = await supabase
      .from("room_participants")
      .select("*, profiles(*)")
      .eq("room_id", roomId);

    if (error) throw error;
    return (data ?? []) as any;
  },

  async updateLastRead(roomId: string, userId: string) {
    const { error } = await supabase
      .from("room_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("user_id", userId);

    if (error) throw error;
  },
};

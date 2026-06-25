import { create } from "zustand";
import type { RoomWithLastMessage } from "@/src/types";
import { roomService } from "@/src/services/roomService";

interface RoomState {
  rooms: RoomWithLastMessage[];
  loading: boolean;
  error: string | null;

  fetchRooms: (userId: string) => Promise<void>;
  updateRoomLastMessage: (
    roomId: string,
    content: string | null,
    senderName: string | null,
    timestamp: string
  ) => void;
  incrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: [],
  loading: false,
  error: null,

  fetchRooms: async (userId) => {
    set({ loading: true, error: null });
    try {
      const rooms = await roomService.getUserRooms(userId);
      set({ rooms, loading: false });
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  updateRoomLastMessage: (roomId, content, senderName, timestamp) => {
    set((state) => ({
      rooms: state.rooms
        .map((room) =>
          room.room_id === roomId
            ? {
                ...room,
                last_message_content: content,
                last_message_sender: senderName,
                last_message_at: timestamp,
              }
            : room
        )
        .sort((a, b) => {
          const aTime = a.last_message_at ?? "";
          const bTime = b.last_message_at ?? "";
          return bTime.localeCompare(aTime);
        }),
    }));
  },

  incrementUnread: (roomId) => {
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.room_id === roomId
          ? { ...room, unread_count: room.unread_count + 1 }
          : room
      ),
    }));
  },

  clearUnread: (roomId) => {
    set((state) => ({
      rooms: state.rooms.map((room) =>
        room.room_id === roomId ? { ...room, unread_count: 0 } : room
      ),
    }));
  },

  reset: () => set({ rooms: [], loading: false, error: null }),
}));

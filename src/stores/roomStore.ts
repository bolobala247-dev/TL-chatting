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
    timestamp: string,
    type: string | null
  ) => void;
  incrementUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;
  toggleBookmark: (roomId: string, userId: string) => Promise<void>;
  reset: () => void;
}

// Mirrors get_user_rooms ordering: bookmarked rooms first (newest bookmark
// on top), then by last message time
function sortRooms(rooms: RoomWithLastMessage[]): RoomWithLastMessage[] {
  return [...rooms].sort((a, b) => {
    if (a.bookmarked_at || b.bookmarked_at) {
      return (b.bookmarked_at ?? "").localeCompare(a.bookmarked_at ?? "");
    }
    return (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "");
  });
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

  updateRoomLastMessage: (roomId, content, senderName, timestamp, type) => {
    set((state) => ({
      rooms: sortRooms(
        state.rooms.map((room) =>
          room.room_id === roomId
            ? {
                ...room,
                last_message_content: content,
                last_message_sender: senderName,
                last_message_at: timestamp,
                last_message_type: type,
              }
            : room
        )
      ),
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

  // Optimistic bookmark toggle: reorder immediately, roll back on error
  toggleBookmark: async (roomId, userId) => {
    const previous = get().rooms;
    const room = previous.find((r) => r.room_id === roomId);
    if (!room) return;

    const next = !room.bookmarked_at;
    const optimisticAt = next ? new Date().toISOString() : null;

    set((state) => ({
      rooms: sortRooms(
        state.rooms.map((r) =>
          r.room_id === roomId ? { ...r, bookmarked_at: optimisticAt } : r
        )
      ),
    }));

    try {
      await roomService.setRoomBookmark(roomId, userId, next);
    } catch (error) {
      console.error("[roomStore] toggleBookmark", error);
      set({ rooms: previous });
    }
  },

  reset: () => set({ rooms: [], loading: false, error: null }),
}));

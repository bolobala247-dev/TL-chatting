import { create } from "zustand";
import type { RoomWithLastMessage } from "@/src/types";
import { roomService } from "@/src/services/roomService";
import { cacheService } from "@/src/services/cacheService";

interface RoomState {
  rooms: RoomWithLastMessage[];
  loading: boolean;
  error: string | null;

  fetchRooms: (userId: string) => Promise<void>;
  // Incremental room-list sync (Phase 4): upsert the changed rows from
  // get_rooms_delta into the list without a full replace.
  applyRoomsDelta: (rows: RoomWithLastMessage[]) => void;
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
    // Hydrate-first (Phase 3): when RAM is empty (cold start), paint the
    // cached list instantly while the network snapshot loads. The cached
    // rows only apply while RAM is still empty, so a fast network response
    // can never be overwritten by stale cache; painting also clears
    // `loading` so the background refresh is silent (no spinner over data).
    if (get().rooms.length === 0) {
      void cacheService.getRooms().then((cached) => {
        if (cached.length > 0 && get().rooms.length === 0) {
          set({ rooms: cached, loading: false });
        }
      });
    }

    set({ loading: true, error: null });
    try {
      const rooms = await roomService.getUserRooms(userId);
      set({ rooms, loading: false });
      // Write-through: persist the fresh snapshot (async, never blocks UI)
      cacheService.saveRooms(rooms);
    } catch (error: any) {
      set({ error: error.message, loading: false });
    }
  },

  // Merge the delta rows into the list: existing rooms are replaced by their
  // fresher server row, brand-new rooms are appended, then the list is
  // re-sorted into room-list order. Membership removals aren't expressed here
  // (see roomService.getRoomsDelta) — those keep the full-resync path.
  applyRoomsDelta: (rows) => {
    if (rows.length === 0) return;
    set((state) => {
      const byId = new Map(state.rooms.map((r) => [r.room_id, r]));
      for (const row of rows) byId.set(row.room_id, row);
      return { rooms: sortRooms(Array.from(byId.values())) };
    });
    // Write-through: persist the merged snapshot (async, never blocks UI)
    cacheService.saveRooms(get().rooms);
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

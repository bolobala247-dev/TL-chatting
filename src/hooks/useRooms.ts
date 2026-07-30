import { useEffect, useCallback } from "react";
import { useAuthStore } from "@/src/stores/authStore";
import { useRoomStore } from "@/src/stores/roomStore";

export function useRooms() {
  const user = useAuthStore((s) => s.user);
  // Individual selectors (not a whole-store destructure) so consumers only
  // re-render when a selected field actually changes
  const rooms = useRoomStore((s) => s.rooms);
  const loading = useRoomStore((s) => s.loading);
  const error = useRoomStore((s) => s.error);
  const fetchRooms = useRoomStore((s) => s.fetchRooms);

  useEffect(() => {
    if (user) {
      fetchRooms(user.id);
    }
  }, [user]);

  const refresh = useCallback(() => {
    if (user) {
      fetchRooms(user.id);
    }
  }, [user, fetchRooms]);

  return { rooms, loading, error, refresh };
}

import { useEffect, useCallback } from "react";
import { useAuthStore } from "@/src/stores/authStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useRealtimeRooms } from "./useRealtime";

export function useRooms() {
  const user = useAuthStore((s) => s.user);
  const { rooms, loading, error, fetchRooms } = useRoomStore();

  useRealtimeRooms();

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

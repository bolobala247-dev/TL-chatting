import { useEffect, useCallback } from "react";
import { useAuthStore } from "@/src/stores/authStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { syncService } from "@/src/services/syncService";

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
      // First mount / login → full pull (lane 4, seeds the room-list cursor)
      fetchRooms(user.id);
    }
  }, [user]);

  // Pull-to-refresh: room-list delta when the flag is on (§10.4); flag-off
  // delegates to the exact fetchRooms full pull used before.
  const refresh = useCallback(() => {
    if (user) {
      void syncService.syncNow("rooms");
    }
  }, [user]);

  return { rooms, loading, error, refresh };
}

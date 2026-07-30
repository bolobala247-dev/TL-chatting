import { useEffect } from "react";
import { InteractionManager } from "react-native";
import { useChatStore } from "@/src/stores/chatStore";
import { useAuthStore } from "@/src/stores/authStore";
import { roomService } from "@/src/services/roomService";
import type { RoomParticipantWithProfile } from "@/src/types";

const EMPTY_PARTICIPANTS: RoomParticipantWithProfile[] = [];

// Single participants fetch per room, shared by the chat header and read
// receipts. Rows live in chatStore so the realtime last_read_at watermark
// updates flow straight into consumers.
export function useRoomParticipants(roomId: string) {
  const userId = useAuthStore((s) => s.user?.id);
  const participants = useChatStore(
    (s) => s.participantsByRoom[roomId] ?? EMPTY_PARTICIPANTS
  );

  useEffect(() => {
    if (!roomId) return;

    // Deferred past the navigation transition: participants only feed the
    // header subtitle + read receipts, not first paint. Peer presence chains
    // off this fetch (otherProfile → usePeerPresence), so it defers too.
    const task = InteractionManager.runAfterInteractions(() => {
      roomService
        .getRoomParticipants(roomId)
        .then((rows) => {
          useChatStore.getState().setRoomParticipants(roomId, rows);
        })
        .catch((err) =>
          console.error("[useRoomParticipants] fetch", err)
        );
    });
    return () => task.cancel();
  }, [roomId]);

  const otherProfile =
    participants.find((p) => p.user_id !== userId)?.profiles ?? null;

  return { participants, otherProfile };
}

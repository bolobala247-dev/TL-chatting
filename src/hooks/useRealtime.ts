import { useEffect } from "react";
import { supabase } from "@/src/lib/supabase";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import type { Message } from "@/src/types";

export function useRealtimeMessages(roomId: string) {
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const removeMessage = useChatStore((s) => s.removeMessage);

  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          addMessage(payload.new as Message);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          updateMessage(payload.new as Message);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          removeMessage((payload.old as any).id, roomId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, addMessage, updateMessage, removeMessage]);
}

export function useRealtimeRooms() {
  const user = useAuthStore((s) => s.user);
  const fetchRooms = useRoomStore((s) => s.fetchRooms);
  const updateRoomLastMessage = useRoomStore((s) => s.updateRoomLastMessage);
  const incrementUnread = useRoomStore((s) => s.incrementUnread);
  const activeRoomId = useChatStore((s) => s.activeRoomId);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("global:messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const message = payload.new as Message;
          updateRoomLastMessage(
            message.room_id,
            message.content,
            null,
            message.created_at
          );
          if (
            message.sender_id !== user.id &&
            message.room_id !== activeRoomId
          ) {
            incrementUnread(message.room_id);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_participants",
        },
        () => {
          fetchRooms(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    user,
    activeRoomId,
    fetchRooms,
    updateRoomLastMessage,
    incrementUnread,
  ]);
}

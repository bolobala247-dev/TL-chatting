import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import { messageService } from "@/src/services/messageService";
import { roomService } from "@/src/services/roomService";
import { useRealtimeMessages } from "./useRealtime";
import type { Message } from "@/src/types";

const EMPTY_MESSAGES: Message[] = [];

export function useMessages(roomId: string) {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const messages = useChatStore((s) => s.messages[roomId] ?? EMPTY_MESSAGES);
  const loading = useChatStore((s) => s.loading);
  const hasMore = useChatStore((s) => s.hasMore[roomId] !== undefined ? s.hasMore[roomId] : true);
  const fetchMessages = useChatStore((s) => s.fetchMessages);
  const setActiveRoom = useChatStore((s) => s.setActiveRoom);
  const addOptimisticMessage = useChatStore((s) => s.addOptimisticMessage);
  const replaceOptimisticMessage = useChatStore(
    (s) => s.replaceOptimisticMessage
  );
  const removeMessage = useChatStore((s) => s.removeMessage);
  const clearUnread = useRoomStore((s) => s.clearUnread);

  useRealtimeMessages(roomId);

  useEffect(() => {
    setActiveRoom(roomId);
    fetchMessages(roomId);
    clearUnread(roomId);

    if (user) {
      roomService.updateLastRead(roomId, user.id);
    }

    return () => {
      setActiveRoom(null);
      if (user) {
        roomService.updateLastRead(roomId, user.id);
      }
    };
  }, [roomId, user]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!user || !content.trim()) return;

      const tempId = `temp-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        room_id: roomId,
        sender_id: user.id,
        content: content.trim(),
        type: "text",
        media_url: null,
        reply_to: null,
        is_edited: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      addOptimisticMessage(optimistic);

      try {
        const sent = await messageService.sendMessage({
          room_id: roomId,
          sender_id: user.id,
          content: content.trim(),
          type: "text",
        });
        replaceOptimisticMessage(tempId, sent);
      } catch {
        removeMessage(tempId, roomId);
      }
    },
    [roomId, user]
  );

  const loadMore = useCallback(() => {
    if (loading || !hasMore || messages.length === 0) return;
    const oldest = messages[messages.length - 1];
    fetchMessages(roomId, oldest.created_at);
  }, [roomId, loading, hasMore, messages]);

  return {
    messages,
    loading,
    hasMore,
    sendMessage,
    loadMore,
  };
}

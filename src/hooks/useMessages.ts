import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import { messageService } from "@/src/services/messageService";
import { roomService } from "@/src/services/roomService";
import { UNDO_SEND_WINDOW_MS } from "@/src/lib/constants";
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

  // Undo-send grace window: last confirmed message stays recallable for a few seconds
  const [undoableMessage, setUndoableMessage] = useState<Message | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useRealtimeMessages(roomId);

  useEffect(() => {
    setActiveRoom(roomId);
    fetchMessages(roomId);
    clearUnread(roomId);

    const userId = user?.id;
    if (userId) {
      roomService
        .updateLastRead(roomId, userId)
        .catch((err) => console.error("[useMessages] updateLastRead", err));
    }

    return () => {
      setActiveRoom(null);
      clearTimeout(undoTimerRef.current);
      setUndoableMessage(null);
      if (userId) {
        roomService
          .updateLastRead(roomId, userId)
          .catch((err) =>
            console.error("[useMessages] updateLastRead", err)
          );
      }
    };
    // user?.id (not the user object) — avoids re-runs on token refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user?.id]);

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
        pinned_at: null,
        pinned_by: null,
        deleted_at: null,
        deleted_by: null,
        has_link: null,
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

        // Open the undo window for this message
        clearTimeout(undoTimerRef.current);
        setUndoableMessage(sent);
        undoTimerRef.current = setTimeout(() => {
          setUndoableMessage(null);
        }, UNDO_SEND_WINDOW_MS);
      } catch {
        removeMessage(tempId, roomId);
      }
    },
    [roomId, user]
  );

  // Hard delete within the window — realtime DELETE removes it for everyone.
  // Returns the recalled text so the composer can restore it.
  const undoSend = useCallback(async (): Promise<string | null> => {
    if (!undoableMessage) return null;

    const target = undoableMessage;
    clearTimeout(undoTimerRef.current);
    setUndoableMessage(null);

    try {
      await messageService.deleteMessage(target.id);
      removeMessage(target.id, roomId);
      return target.content;
    } catch (err) {
      console.error("[useMessages] undo send", err);
      throw err;
    }
  }, [undoableMessage, roomId]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || messages.length === 0) return;
    const oldest = messages[messages.length - 1];
    fetchMessages(roomId, oldest.created_at ?? undefined);
  }, [roomId, loading, hasMore, messages]);

  return {
    messages,
    loading,
    hasMore,
    sendMessage,
    loadMore,
    undoableMessage,
    undoSend,
  };
}

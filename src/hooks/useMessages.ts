import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import { messageService } from "@/src/services/messageService";
import { reactionService } from "@/src/services/reactionService";
import { pollService } from "@/src/services/pollService";
import { roomService } from "@/src/services/roomService";
import { UNDO_SEND_WINDOW_MS } from "@/src/lib/constants";
import { useRealtimeMessages } from "./useRealtime";
import type { Message, MessageWithMeta } from "@/src/types";

const EMPTY_MESSAGES: MessageWithMeta[] = [];

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
  const applyReactionChange = useChatStore((s) => s.applyReactionChange);
  const applyVoteChange = useChatStore((s) => s.applyVoteChange);
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
        attachments: null,
        metadata: null,
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

  // Album: optimistic bubble with the local URIs while uploads run
  const sendAlbum = useCallback(
    async (imageUris: string[], caption?: string) => {
      if (!user || imageUris.length === 0) return;

      const tempId = `temp-${Date.now()}`;
      const optimistic: MessageWithMeta = {
        id: tempId,
        room_id: roomId,
        sender_id: user.id,
        content: caption?.trim() || null,
        type: "image",
        media_url: imageUris[0],
        reply_to: null,
        is_edited: false,
        pinned_at: null,
        pinned_by: null,
        deleted_at: null,
        deleted_by: null,
        has_link: null,
        attachments: imageUris.map((url) => ({ url })) as any,
        metadata: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      addOptimisticMessage(optimistic);

      try {
        const sent = await messageService.sendAlbumMessage(
          roomId,
          user.id,
          imageUris,
          caption
        );
        replaceOptimisticMessage(tempId, sent);
      } catch (err) {
        removeMessage(tempId, roomId);
        throw err;
      }
    },
    [roomId, user]
  );

  const sendPoll = useCallback(
    async (question: string, options: string[]) => {
      if (!user || !question.trim() || options.length < 2) return;

      const tempId = `temp-${Date.now()}`;
      const optimistic: MessageWithMeta = {
        id: tempId,
        room_id: roomId,
        sender_id: user.id,
        content: question.trim(),
        type: "poll",
        media_url: null,
        reply_to: null,
        is_edited: false,
        pinned_at: null,
        pinned_by: null,
        deleted_at: null,
        deleted_by: null,
        has_link: null,
        attachments: null,
        metadata: { question: question.trim(), options } as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        poll_votes: [],
      };

      addOptimisticMessage(optimistic);

      try {
        const sent = await messageService.sendPollMessage(
          roomId,
          user.id,
          question,
          options
        );
        replaceOptimisticMessage(tempId, sent);
      } catch (err) {
        removeMessage(tempId, roomId);
        throw err;
      }
    },
    [roomId, user]
  );

  // Optimistic toggle with revert; realtime echo dedups in the store
  const toggleReaction = useCallback(
    async (message: MessageWithMeta, emoji: string) => {
      if (!user) return;

      const patch = { user_id: user.id, emoji };
      const hasReacted = (message.message_reactions ?? []).some(
        (r) => r.user_id === user.id && r.emoji === emoji
      );

      applyReactionChange(
        roomId,
        message.id,
        patch,
        hasReacted ? "remove" : "add"
      );

      try {
        if (hasReacted) {
          await reactionService.removeReaction(message.id, user.id, emoji);
        } else {
          await reactionService.addReaction(message.id, roomId, user.id, emoji);
        }
      } catch (err) {
        // Revert the optimistic patch
        applyReactionChange(
          roomId,
          message.id,
          patch,
          hasReacted ? "add" : "remove"
        );
        console.error("[useMessages] toggleReaction", err);
      }
    },
    [roomId, user]
  );

  // Tap current choice = unvote, tap another = change vote (single choice)
  const votePoll = useCallback(
    async (message: MessageWithMeta, optionIndex: number) => {
      if (!user) return;

      const previous =
        (message.poll_votes ?? []).find((v) => v.user_id === user.id) ?? null;
      const isUnvote = previous?.option_index === optionIndex;
      const patch = { user_id: user.id, option_index: optionIndex };

      applyVoteChange(roomId, message.id, patch, isUnvote ? "remove" : "add");

      try {
        if (isUnvote) {
          await pollService.unvote(message.id, user.id);
        } else {
          await pollService.vote(message.id, roomId, user.id, optionIndex);
        }
      } catch (err) {
        // Restore the previous vote state
        if (previous) {
          applyVoteChange(roomId, message.id, previous, "add");
        } else {
          applyVoteChange(roomId, message.id, patch, "remove");
        }
        console.error("[useMessages] votePoll", err);
      }
    },
    [roomId, user]
  );

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
    sendAlbum,
    sendPoll,
    toggleReaction,
    votePoll,
    loadMore,
    undoableMessage,
    undoSend,
  };
}

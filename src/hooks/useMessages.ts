import { useCallback, useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import { messageService } from "@/src/services/messageService";
import { reactionService } from "@/src/services/reactionService";
import { pollService } from "@/src/services/pollService";
import { roomService } from "@/src/services/roomService";
import { syncService } from "@/src/services/syncService";
import { outboxService } from "@/src/services/outboxService";
import { mediaService, type MediaSource } from "@/src/services/mediaService";
import { cacheService } from "@/src/services/cacheService";
import {
  FEATURE_INTELLIGENT_PREFETCH,
  FEATURE_MEDIA_PIPELINE,
  FEATURE_OFFLINE_OUTBOX,
  UNDO_SEND_WINDOW_MS,
} from "@/src/lib/constants";
import { useRoomOpenStats } from "@/src/stores/roomOpenStats";
import { useRealtimeMessages } from "./useRealtime";
import type { Message, MessageMention, MessageWithMeta } from "@/src/types";

const EMPTY_MESSAGES: MessageWithMeta[] = [];

export function useMessages(roomId: string) {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const messages = useChatStore((s) => s.messages[roomId] ?? EMPTY_MESSAGES);
  const loading = useChatStore((s) => s.loadingByRoom[roomId] ?? false);
  const hasMore = useChatStore((s) => s.hasMore[roomId] !== undefined ? s.hasMore[roomId] : true);
  const setActiveRoom = useChatStore((s) => s.setActiveRoom);
  const addOptimisticMessage = useChatStore((s) => s.addOptimisticMessage);
  const enqueueOptimistic = useChatStore((s) => s.enqueueOptimistic);
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
    // Feed the device-local open-frequency model (§2.3): the warm-set selector
    // blends this with recency to keep "frequent but not recent" rooms warm.
    // Flag-gated — no persisted writes when prefetch is off.
    if (FEATURE_INTELLIGENT_PREFETCH) {
      useRoomOpenStats.getState().recordOpen(roomId);
    }
    // Room-open recovery: syncService picks the delta lane for a resident
    // (same-session revisit) room and the page fetch for a cold first open
    // (§17 C6); flag-off delegates to the exact page-1 fetch used before.
    void syncService.syncNow({ room: roomId });
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
    async (content: string, mentions?: MessageMention[]) => {
      if (!user || !content.trim()) return;

      // Tagged users ride along in metadata (no schema change)
      const metadata = mentions?.length ? { mentions } : null;

      // Flag on (§2, §11.1): durable, idempotent outbox path. The client mints
      // the FINAL id (a v4 UUID = the idempotency key — no temp- swap); the
      // message persists PENDING (survives restart, renders "đang gửi") and the
      // worker delivers it. No remove-on-error: a failed send parks as FAILED
      // with a retry/delete affordance (§11), the outbox worker owns delivery.
      if (FEATURE_OFFLINE_OUTBOX) {
        const now = new Date().toISOString();
        const optimistic: MessageWithMeta = {
          id: Crypto.randomUUID(),
          room_id: roomId,
          sender_id: user.id,
          content: content.trim(),
          type: "text",
          media_url: null,
          reply_to: null,
          thread_id: null,
          is_edited: false,
          pinned_at: null,
          pinned_by: null,
          deleted_at: null,
          deleted_by: null,
          has_link: null,
          attachments: null,
          metadata: metadata as any,
          created_at: now,
          updated_at: now,
        };
        enqueueOptimistic(optimistic);
        outboxService.poke();
        return;
      }

      const tempId = `temp-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        room_id: roomId,
        sender_id: user.id,
        content: content.trim(),
        type: "text",
        media_url: null,
        reply_to: null,
        thread_id: null,
        is_edited: false,
        pinned_at: null,
        pinned_by: null,
        deleted_at: null,
        deleted_by: null,
        has_link: null,
        attachments: null,
        metadata: metadata as any,
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
          metadata: metadata as any,
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

      // Flag on (§2, §4): durable two-plane media. The client mints the FINAL
      // id (v4 UUID); the message persists PENDING with staged local URIs and
      // the media worker uploads each attachment, then hands off to the outbox.
      // Staging failure throws synchronously (M9) → remove the RAM bubble.
      if (FEATURE_MEDIA_PIPELINE && mediaService.isEnabled()) {
        const now = new Date().toISOString();
        const optimistic: MessageWithMeta = {
          id: Crypto.randomUUID(),
          room_id: roomId,
          sender_id: user.id,
          content: caption?.trim() || null,
          type: "image",
          media_url: imageUris[0],
          reply_to: null,
          thread_id: null,
          is_edited: false,
          pinned_at: null,
          pinned_by: null,
          deleted_at: null,
          deleted_by: null,
          has_link: null,
          attachments: imageUris.map((url) => ({ url })) as any,
          metadata: null,
          created_at: now,
          updated_at: now,
          outbox_status: "pending",
        };
        addOptimisticMessage(optimistic);
        const sources: MediaSource[] = imageUris.map((uri) => ({
          uri,
          kind: "image",
        }));
        try {
          await mediaService.enqueueMediaMessage(optimistic, sources);
        } catch (err) {
          removeMessage(optimistic.id, roomId);
          throw err;
        }
        return;
      }

      const tempId = `temp-${Date.now()}`;
      const optimistic: MessageWithMeta = {
        id: tempId,
        room_id: roomId,
        sender_id: user.id,
        content: caption?.trim() || null,
        type: "image",
        media_url: imageUris[0],
        reply_to: null,
        thread_id: null,
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

      // Flag on: poll sends are durable too (§0 — text + poll are in scope). A
      // poll is just a message row (type='poll', metadata carries the question
      // + options), so the same idempotent outbox path applies.
      if (FEATURE_OFFLINE_OUTBOX) {
        const now = new Date().toISOString();
        const optimistic: MessageWithMeta = {
          id: Crypto.randomUUID(),
          room_id: roomId,
          sender_id: user.id,
          content: question.trim(),
          type: "poll",
          media_url: null,
          reply_to: null,
          thread_id: null,
          is_edited: false,
          pinned_at: null,
          pinned_by: null,
          deleted_at: null,
          deleted_by: null,
          has_link: null,
          attachments: null,
          metadata: { question: question.trim(), options } as any,
          created_at: now,
          updated_at: now,
          poll_votes: [],
        };
        enqueueOptimistic(optimistic);
        outboxService.poke();
        return;
      }

      const tempId = `temp-${Date.now()}`;
      const optimistic: MessageWithMeta = {
        id: tempId,
        room_id: roomId,
        sender_id: user.id,
        content: question.trim(),
        type: "poll",
        media_url: null,
        reply_to: null,
        thread_id: null,
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

  // Reads pagination state imperatively so the callback stays stable —
  // FlashList's onStartReached keeps its identity across message updates
  const loadMore = useCallback(() => {
    const state = useChatStore.getState();
    if (state.loadingByRoom[roomId] || state.hasMore[roomId] === false) return;
    const roomMessages = state.messages[roomId] ?? EMPTY_MESSAGES;
    if (roomMessages.length === 0) return;
    const oldest = roomMessages[roomMessages.length - 1];
    state.fetchMessages(roomId, oldest.created_at ?? undefined);
  }, [roomId]);

  // Retry a FAILED send (§13.4): re-enter PENDING with the SAME id (the
  // idempotency key never changes) so the server returns the existing row if it
  // slipped through earlier — never a duplicate. enqueueOptimistic patches the
  // bubble back to pending and INSERT-OR-REPLACEs the outbox row (attempts=0,
  // state=pending); the poke drives delivery.
  const retryMessage = useCallback((message: MessageWithMeta) => {
    if (!FEATURE_OFFLINE_OUTBOX) return;
    // Media plane owns the retry while any attachment is still un-uploaded
    // (re-drives uploads, not delivery). Returns false → 5A delivery retry.
    void mediaService.retryMedia(message).then((handled) => {
      if (handled) return;
      enqueueOptimistic(message);
      outboxService.poke();
    });
  }, []);

  // Discard a PENDING/FAILED send (§7.4, §11.1): remove it locally (RAM +
  // message row + outbox row). It was never accepted by the server, so there is
  // nothing to recall — no network op.
  const discardMessage = useCallback(
    (message: MessageWithMeta) => {
      // Optimistic RAM removal first; the media plane then tears down its
      // durable state (queue rows, staging dir, uploaded objects). When the
      // media plane doesn't own it, fall back to the 5A outbox removal.
      removeMessage(message.id, roomId);
      void mediaService.discardMedia(message).then((handled) => {
        if (!handled) void cacheService.removeOutbox(message.id);
      });
    },
    [roomId]
  );

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
    retryMessage,
    discardMessage,
  };
}

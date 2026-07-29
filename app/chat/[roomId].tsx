import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import * as ImagePicker from "expo-image-picker";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView } from "@/src/lib/keyboard";
import { useMessages } from "@/src/hooks/useMessages";
import { useTypingIndicator } from "@/src/hooks/useTypingIndicator";
import { useRoomParticipants } from "@/src/hooks/useRoomParticipants";
import { usePeerPresence } from "@/src/hooks/usePresence";
import { messageService } from "@/src/services/messageService";
import { savedMessageService } from "@/src/services/savedMessageService";
import { scheduledMessageService } from "@/src/services/scheduledMessageService";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { useDraftStore } from "@/src/stores/draftStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { DRAFT_SAVE_DEBOUNCE_MS, MAX_ALBUM_IMAGES } from "@/src/lib/constants";
import { getAttachments } from "@/src/lib/messageMeta";
import {
  getMentionQuery,
  insertMention,
  extractMentions,
} from "@/src/lib/mentions";
import { ChatHeader } from "@/src/components/chat/ChatHeader";
import { MessageList } from "@/src/components/chat/MessageList";
import { MessageInput } from "@/src/components/chat/MessageInput";
import { MentionAutocomplete } from "@/src/components/chat/MentionAutocomplete";
import { TypingIndicator } from "@/src/components/chat/TypingIndicator";
import { MessageActions } from "@/src/components/chat/MessageActions";
import { ReactionsSheet } from "@/src/components/chat/ReactionBar";
import { ReadReceiptsSheet } from "@/src/components/chat/ReadReceiptsSheet";
import { AttachmentSheet } from "@/src/components/chat/AttachmentSheet";
import { ImageViewerModal } from "@/src/components/chat/ImageViewerModal";
import { PollComposer } from "@/src/components/chat/PollComposer";
import { PollVotersSheet } from "@/src/components/chat/PollBubble";
import { ReplyPreview } from "@/src/components/chat/ReplyPreview";
import { PinnedBanner } from "@/src/components/chat/PinnedBanner";
import { PinnedMessagesSheet } from "@/src/components/chat/PinnedMessagesSheet";
import { ScheduleSheet } from "@/src/components/chat/ScheduleSheet";
import { ScheduledMessagesSheet } from "@/src/components/chat/ScheduledMessagesSheet";
import { UndoSendBar } from "@/src/components/chat/UndoSendBar";
import { ContactInfoSheet } from "@/src/components/chat/ContactInfoSheet";
import { ReportUserSheet } from "@/src/components/chat/ReportUserSheet";
import { Icon } from "@/src/components/ui/Icon";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";
import { Dialog } from "@/src/components/ui/Dialog";
import { Button } from "@/src/components/ui/Button";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { Message, MessageWithMeta, MessageAttachment, MessageMention, ScheduledMessage } from "@/src/types";

export default function ChatScreen() {
  const { t } = useTranslation(["chat", "common", "errors"]);
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const updateMessageInStore = useChatStore((s) => s.updateMessage);
  const {
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
  } = useMessages(roomId!);
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(roomId!);

  // Single participants fetch: header + read receipts share it
  const { participants, otherProfile } = useRoomParticipants(roomId!);
  const roomName = otherProfile
    ? otherProfile.display_name || otherProfile.username
    : "";
  const roomAvatar = otherProfile?.avatar_url ?? null;
  const participantCount = participants.length;
  const isGroup = participantCount > 2;

  // DM-only: privacy-gated peer presence + block state (get_peer_profile)
  const peerId = !isGroup ? otherProfile?.id ?? null : null;
  const { peer, refresh: refreshPeer } = usePeerPresence(peerId);
  const isDmBlocked = !!peer?.is_blocked_by_me;

  // Composer text lives here so drafts can persist per room
  const [inputText, setInputText] = useState("");
  const inputTextRef = useRef("");
  const draftTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const updateInputText = useCallback((text: string) => {
    inputTextRef.current = text;
    setInputText(text);
  }, []);

  const [selectedMessage, setSelectedMessage] = useState<MessageWithMeta | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [reactionsTarget, setReactionsTarget] = useState<MessageWithMeta | null>(null);
  const [receiptsTarget, setReceiptsTarget] = useState<MessageWithMeta | null>(null);
  const [votersTarget, setVotersTarget] = useState<MessageWithMeta | null>(null);
  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showPollComposer, setShowPollComposer] = useState(false);
  const [albumView, setAlbumView] = useState<{
    images: MessageAttachment[];
    index: number;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [chatError, setChatError] = useState("");
  // Users picked from the @ autocomplete; pruned against the text on send
  const [trackedMentions, setTrackedMentions] = useState<MessageMention[]>([]);
  const mentionQuery = getMentionQuery(inputText);
  const [showContactInfo, setShowContactInfo] = useState(false);
  // Report target: DM peer (from contact sheet) or a message sender
  const [reportTarget, setReportTarget] = useState<{
    userId: string;
    messageId?: string;
  } | null>(null);

  const [recallTarget, setRecallTarget] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState("");

  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [showPinnedSheet, setShowPinnedSheet] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [scheduled, setScheduled] = useState<ScheduledMessage[]>([]);
  const [showScheduledList, setShowScheduledList] = useState(false);
  // Draft captured on long-press send; non-null while the schedule sheet is open
  const [scheduleDraft, setScheduleDraft] = useState<string | null>(null);

  // Collapse the bottom safe-area padding in sync with the keyboard so the
  // composer sits flush above it (no double gap, no jump) — runs on UI thread
  const { progress } = useReanimatedKeyboardAnimation();
  const composerInsetStyle = useAnimatedStyle(
    () => ({
      paddingBottom: interpolate(progress.value, [0, 1], [insets.bottom, 0]),
    }),
    [insets.bottom]
  );

  // Seed the composer from the saved draft; flush it back on leave
  useEffect(() => {
    if (!roomId) return;

    const draft = useDraftStore.getState().drafts[roomId]?.text ?? "";
    inputTextRef.current = draft;
    setInputText(draft);

    return () => {
      clearTimeout(draftTimerRef.current);
      useDraftStore.getState().setDraft(roomId, inputTextRef.current);
    };
  }, [roomId]);

  const handleChangeText = useCallback(
    (text: string) => {
      inputTextRef.current = text;
      setInputText(text);

      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        if (roomId) useDraftStore.getState().setDraft(roomId, text);
      }, DRAFT_SAVE_DEBOUNCE_MS);
    },
    [roomId]
  );

  // Feature data: pinned list, saved bookmarks, pending scheduled sends
  useEffect(() => {
    if (!roomId || !user) return;

    messageService
      .getPinnedMessages(roomId)
      .then(setPinnedMessages)
      .catch((err) => console.error("[ChatScreen] load pinned", err));
    savedMessageService
      .getSavedIdsForRoom(roomId)
      .then(setSavedIds)
      .catch((err) => console.error("[ChatScreen] load saved ids", err));
    scheduledMessageService
      .getPendingForRoom(roomId)
      .then(setScheduled)
      .catch((err) => console.error("[ChatScreen] load scheduled", err));
  }, [roomId, user]);

  // Keep the pinned list in sync with realtime pin/unpin/recall updates
  useEffect(() => {
    setPinnedMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      let changed = false;

      for (const m of messages) {
        if (m.pinned_at && !m.deleted_at) {
          const existing = byId.get(m.id);
          if (
            !existing ||
            existing.pinned_at !== m.pinned_at ||
            existing.content !== m.content
          ) {
            byId.set(m.id, m);
            changed = true;
          }
        } else if (byId.has(m.id)) {
          byId.delete(m.id);
          changed = true;
        }
      }

      if (!changed) return prev;
      return [...byId.values()].sort((a, b) =>
        (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "")
      );
    });
  }, [messages]);

  const handleLongPress = useCallback((message: MessageWithMeta) => {
    setSelectedMessage(message);
    setShowActions(true);
  }, []);

  const handleShowReactions = useCallback((message: MessageWithMeta) => {
    setReactionsTarget(message);
  }, []);

  const handleViewReceipts = useCallback((message: MessageWithMeta) => {
    setReceiptsTarget(message);
  }, []);

  const handleViewVoters = useCallback((message: MessageWithMeta) => {
    setVotersTarget(message);
  }, []);

  const handleReportMessage = useCallback((message: MessageWithMeta) => {
    setReportTarget({ userId: message.sender_id, messageId: message.id });
  }, []);

  const handleUnblockPeer = useCallback(async () => {
    if (!user || !peer) return;
    try {
      await usePrivacyStore.getState().unblockUser(user.id, peer.id);
      refreshPeer();
    } catch {
      setChatError(t("block.unblockFailed"));
    }
  }, [user, peer, refreshPeer, t]);

  const handleOpenAlbum = useCallback(
    (message: MessageWithMeta, index: number) => {
      const images = getAttachments(message);
      if (images.length > 0) setAlbumView({ images, index });
    },
    []
  );

  const handleReply = useCallback((message: Message) => {
    setReplyTo(message);
  }, []);

  const handleSelectMention = useCallback(
    (mention: MessageMention) => {
      updateInputText(insertMention(inputTextRef.current, mention.username));
      setTrackedMentions((prev) =>
        prev.some((m) => m.id === mention.id) ? prev : [...prev, mention]
      );
    },
    [updateInputText]
  );

  // Replies open their root's thread; roots open their own
  const handleOpenThread = useCallback(
    (message: MessageWithMeta) => {
      router.push({
        pathname: "/chat/thread" as any,
        params: { roomId: roomId!, rootId: message.thread_id ?? message.id },
      });
    },
    [router, roomId]
  );

  const handleEdit = useCallback((message: Message) => {
    setEditingMessage(message);
    setEditContent(message.content || "");
    setEditError("");
  }, []);

  const confirmEdit = async () => {
    if (!editingMessage || !editContent.trim()) {
      setEditError(t("message.editEmpty"));
      return;
    }

    try {
      const updated = await messageService.updateMessage(
        editingMessage.id,
        editContent.trim()
      );
      updateMessageInStore(updated);
      setEditingMessage(null);
      setEditContent("");
      setEditError("");
    } catch (err: unknown) {
      console.error("[ChatScreen] edit message", err);
      const msg =
        err instanceof Error ? err.message : t("message.editFailed");
      setEditError(msg);
    }
  };

  const handleRecall = useCallback((message: Message) => {
    setRecallTarget(message);
  }, []);

  const confirmRecall = async () => {
    if (!recallTarget || !user) return;

    const target = recallTarget;
    setRecallTarget(null);

    try {
      const updated = await messageService.deleteForEveryone(
        target.id,
        user.id
      );
      updateMessageInStore(updated);
    } catch (err: unknown) {
      console.error("[ChatScreen] recall message", err);
      const msg =
        err instanceof Error ? err.message : t("message.recallFailed");
      setChatError(msg);
    }
  };

  const handlePin = useCallback(
    async (message: Message, pinned: boolean) => {
      try {
        const updated = await messageService.setPinned(message.id, pinned);
        updateMessageInStore(updated);
        setPinnedMessages((prev) => {
          const rest = prev.filter((m) => m.id !== updated.id);
          if (!updated.pinned_at) return rest;
          return [updated, ...rest].sort((a, b) =>
            (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "")
          );
        });
      } catch (err: unknown) {
        console.error("[ChatScreen] pin message", err);
        setChatError(t("message.pinFailed"));
      }
    },
    [updateMessageInStore, t]
  );

  const handleSave = useCallback(
    async (message: Message, save: boolean) => {
      if (!user) return;
      try {
        if (save) {
          await savedMessageService.save(user.id, message.id);
          setSavedIds((prev) => new Set(prev).add(message.id));
        } else {
          await savedMessageService.unsave(message.id);
          setSavedIds((prev) => {
            const next = new Set(prev);
            next.delete(message.id);
            return next;
          });
        }
      } catch (err: unknown) {
        console.error("[ChatScreen] save message", err);
        setChatError(t("message.saveFailed"));
      }
    },
    [user, t]
  );

  const handleUndo = useCallback(async () => {
    try {
      const recalled = await undoSend();
      if (recalled) updateInputText(recalled);
    } catch {
      setChatError(t("undo.failed"));
    }
  }, [undoSend, updateInputText, t]);

  const handleLongPressSend = useCallback(
    (content: string) => {
      setScheduleDraft(content);
      updateInputText("");
    },
    [updateInputText]
  );

  const handleSchedulePick = useCallback(
    async (date: Date) => {
      if (!user || !roomId || !scheduleDraft) return;

      const draft = scheduleDraft;
      setScheduleDraft(null);

      try {
        const created = await scheduledMessageService.schedule(
          roomId,
          user.id,
          draft,
          date,
          replyTo?.id
        );
        setScheduled((prev) =>
          [...prev, created].sort((a, b) =>
            a.scheduled_at.localeCompare(b.scheduled_at)
          )
        );
        setReplyTo(null);
      } catch (err: unknown) {
        console.error("[ChatScreen] schedule message", err);
        updateInputText(draft);
        setChatError(t("schedule.failed"));
      }
    },
    [user, roomId, scheduleDraft, replyTo, updateInputText, t]
  );

  const handleScheduleClose = useCallback(() => {
    // Dismissed without picking — hand the draft back to the composer
    if (scheduleDraft) updateInputText(scheduleDraft);
    setScheduleDraft(null);
  }, [scheduleDraft, updateInputText]);

  const handleCancelScheduled = useCallback(
    async (item: ScheduledMessage) => {
      try {
        await scheduledMessageService.cancel(item.id);
        setScheduled((prev) => prev.filter((s) => s.id !== item.id));
      } catch (err: unknown) {
        console.error("[ChatScreen] cancel scheduled", err);
        setChatError(t("schedule.cancelFailed"));
      }
    },
    [t]
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (chatError) setChatError("");

      // Only mentions whose @username survived edits are persisted
      const mentions = extractMentions(content, trackedMentions);
      setTrackedMentions([]);

      // Composer + persisted draft clear as soon as the send is issued
      updateInputText("");
      clearTimeout(draftTimerRef.current);
      if (roomId) useDraftStore.getState().clearDraft(roomId);

      if (replyTo) {
        if (!user) return;
        try {
          await messageService.sendMessage({
            room_id: roomId!,
            sender_id: user.id,
            content: content.trim(),
            type: "text",
            reply_to: replyTo.id,
            // Replies join the parent's thread (or start one at the parent)
            thread_id: replyTo.thread_id ?? replyTo.id,
            metadata: mentions.length ? ({ mentions } as any) : null,
          });
        } catch (err: unknown) {
          console.error("[ChatScreen] send reply", err);
          const msg =
            err instanceof Error ? err.message : t("message.sendFailed");
          setChatError(msg);
        }
        setReplyTo(null);
      } else {
        sendMessage(content, mentions);
      }
    },
    [replyTo, sendMessage, roomId, user, chatError, updateInputText, trackedMentions]
  );

  // "+" opens the attachment sheet; the picker/composer follow from there
  const handleAttach = useCallback(() => {
    if (chatError) setChatError("");
    setShowAttachSheet(true);
  }, [chatError]);

  const handlePickPhotos = useCallback(async () => {
    if (!user || !roomId) return;

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setChatError(t("errors:mediaLibraryPermission"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_ALBUM_IMAGES,
      quality: 0.8,
    });

    if (result.canceled || result.assets.length === 0) return;

    try {
      await sendAlbum(result.assets.map((asset) => asset.uri));
    } catch (err: unknown) {
      console.error("[ChatScreen] send album", err);
      setChatError(t("album.sendFailed"));
    }
  }, [roomId, user, sendAlbum, t]);

  const handleSendPoll = useCallback(
    async (question: string, options: string[]) => {
      try {
        await sendPoll(question, options);
      } catch (err: unknown) {
        console.error("[ChatScreen] send poll", err);
        setChatError(t("poll.sendFailed"));
      }
    },
    [sendPoll, t]
  );

  if (!roomId) {
    return <Spinner fullScreen />;
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior="padding"
    >
      <View style={{ paddingTop: insets.top }}>
        <ChatHeader
          name={roomName || t("defaultRoomName")}
          avatarUrl={roomAvatar}
          isOnline={!isGroup ? peer?.is_online : undefined}
          lastSeenAt={!isGroup ? peer?.last_seen_at : undefined}
          participantCount={isGroup ? participantCount : undefined}
          onPressInfo={
            !isGroup && otherProfile
              ? () => setShowContactInfo(true)
              : undefined
          }
          onPressMedia={() =>
            router.push({ pathname: "/chat/media", params: { roomId } })
          }
        />
        <PinnedBanner
          pinnedMessages={pinnedMessages}
          onPress={() => setShowPinnedSheet(true)}
        />
      </View>

      <View className="flex-1">
        <MessageList
          messages={messages}
          loading={loading}
          hasMore={hasMore}
          participants={participants}
          showPollVoters={isGroup}
          onLoadMore={loadMore}
          onMessageLongPress={handleLongPress}
          onToggleReaction={toggleReaction}
          onShowReactions={handleShowReactions}
          onOpenAlbum={handleOpenAlbum}
          onVote={votePoll}
          onViewVoters={handleViewVoters}
          onOpenThread={handleOpenThread}
        />
      </View>

      <Animated.View style={composerInsetStyle}>
        <UndoSendBar visible={!!undoableMessage} onUndo={handleUndo} />
        <TypingIndicator typingUsers={typingUsers} />
        {chatError ? (
          <View className="border-t border-divider bg-danger-bg px-4 py-2">
            <FormMessage>{chatError}</FormMessage>
          </View>
        ) : null}
        {scheduled.length > 0 && (
          <Pressable
            className="flex-row items-center gap-2 border-t border-divider bg-surface px-4 py-2 active:bg-pressed"
            onPress={() => setShowScheduledList(true)}
            accessibilityRole="button"
            accessibilityLabel={t("schedule.listTitle")}
          >
            <Icon
              name={{ ios: "clock", android: "schedule", web: "schedule" }}
              tone="secondary"
              size="sm"
            />
            <Text className="font-sans text-caption text-fg-secondary">
              {t("schedule.pending", { count: scheduled.length })}
            </Text>
          </Pressable>
        )}
        {replyTo && (
          <ReplyPreview
            message={replyTo}
            onDismiss={() => setReplyTo(null)}
          />
        )}
        {mentionQuery !== null && !isDmBlocked && (
          <MentionAutocomplete
            participants={participants}
            query={mentionQuery}
            excludeUserId={user?.id}
            onSelect={handleSelectMention}
          />
        )}
        {isDmBlocked ? (
          // Blocked DM: composer is replaced — RLS also rejects sends server-side
          <View className="flex-row items-center justify-between border-t border-divider bg-surface px-4 py-3">
            <Text className="flex-1 font-sans text-caption text-fg-secondary">
              {t("block.blockedBanner")}
            </Text>
            <Pressable
              onPress={handleUnblockPeer}
              className="rounded-full border border-border px-3 py-1.5 active:bg-pressed"
              accessibilityRole="button"
            >
              <Text className="font-sans-medium text-caption text-fg">
                {t("block.unblock")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <MessageInput
            value={inputText}
            onChangeText={handleChangeText}
            onSend={handleSend}
            onAttach={handleAttach}
            onLongPressSend={handleLongPressSend}
            onTypingStart={startTyping}
            onTypingStop={stopTyping}
          />
        )}
      </Animated.View>

      <MessageActions
        message={selectedMessage}
        visible={showActions}
        isSaved={selectedMessage ? savedIds.has(selectedMessage.id) : false}
        onClose={() => setShowActions(false)}
        onReply={handleReply}
        onPin={handlePin}
        onSave={handleSave}
        onEdit={handleEdit}
        onDelete={handleRecall}
        onReact={toggleReaction}
        onViewReceipts={handleViewReceipts}
        onReport={handleReportMessage}
        onOpenThread={handleOpenThread}
      />

      <ReactionsSheet
        message={reactionsTarget}
        visible={!!reactionsTarget}
        onClose={() => setReactionsTarget(null)}
      />

      <ContactInfoSheet
        visible={showContactInfo}
        peer={peer}
        fallbackName={roomName || t("defaultRoomName")}
        fallbackAvatarUrl={roomAvatar}
        onClose={() => setShowContactInfo(false)}
        onReport={() => {
          if (otherProfile) setReportTarget({ userId: otherProfile.id });
        }}
        onBlockChanged={refreshPeer}
      />

      <ReportUserSheet
        visible={!!reportTarget}
        reportedUserId={reportTarget?.userId ?? null}
        messageId={reportTarget?.messageId ?? null}
        onClose={() => setReportTarget(null)}
      />

      <ReadReceiptsSheet
        message={receiptsTarget}
        visible={!!receiptsTarget}
        onClose={() => setReceiptsTarget(null)}
      />

      <PollVotersSheet
        message={votersTarget}
        visible={!!votersTarget}
        onClose={() => setVotersTarget(null)}
      />

      <AttachmentSheet
        visible={showAttachSheet}
        onClose={() => setShowAttachSheet(false)}
        onPickPhotos={handlePickPhotos}
        onCreatePoll={() => setShowPollComposer(true)}
      />

      <PollComposer
        visible={showPollComposer}
        onClose={() => setShowPollComposer(false)}
        onSubmit={handleSendPoll}
      />

      <ImageViewerModal
        attachments={albumView?.images ?? []}
        initialIndex={albumView?.index ?? 0}
        visible={!!albumView}
        onClose={() => setAlbumView(null)}
      />

      <ConfirmDialog
        visible={!!recallTarget}
        title={t("message.recallTitle")}
        message={t("message.recallConfirm")}
        confirmText={t("message.recallAction")}
        cancelText={t("common:actions.cancel")}
        destructive
        onConfirm={confirmRecall}
        onCancel={() => setRecallTarget(null)}
      />

      <PinnedMessagesSheet
        visible={showPinnedSheet}
        pinnedMessages={pinnedMessages}
        onClose={() => setShowPinnedSheet(false)}
        onUnpin={(message) => handlePin(message, false)}
      />

      <ScheduleSheet
        visible={scheduleDraft !== null}
        onClose={handleScheduleClose}
        onPick={handleSchedulePick}
      />

      <ScheduledMessagesSheet
        visible={showScheduledList}
        scheduledMessages={scheduled}
        onClose={() => setShowScheduledList(false)}
        onCancel={handleCancelScheduled}
      />

      <Dialog
        visible={!!editingMessage}
        onClose={() => setEditingMessage(null)}
        title={t("message.editTitle")}
        footer={
          <>
            <View className="flex-1">
              <Button
                title={t("common:actions.cancel")}
                variant="secondary"
                size="md"
                onPress={() => setEditingMessage(null)}
              />
            </View>
            <View className="flex-1">
              <Button
                title={t("common:actions.save")}
                size="md"
                onPress={confirmEdit}
              />
            </View>
          </>
        }
      >
        <TextInput
          className={`mt-2 min-h-[88px] rounded-xl border bg-surface-secondary px-4 py-3 font-sans text-body text-fg ${
            editError ? "border-danger" : "border-border"
          }`}
          value={editContent}
          onChangeText={(text) => {
            setEditContent(text);
            if (editError) setEditError("");
          }}
          multiline
          autoFocus
        />
        {editError ? (
          <FormMessage className="mt-2">{editError}</FormMessage>
        ) : null}
      </Dialog>
    </KeyboardAvoidingView>
  );
}

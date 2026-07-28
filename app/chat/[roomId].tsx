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
import { roomService } from "@/src/services/roomService";
import { messageService } from "@/src/services/messageService";
import { savedMessageService } from "@/src/services/savedMessageService";
import { scheduledMessageService } from "@/src/services/scheduledMessageService";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { ChatHeader } from "@/src/components/chat/ChatHeader";
import { MessageList } from "@/src/components/chat/MessageList";
import {
  MessageInput,
  type MessageInputHandle,
} from "@/src/components/chat/MessageInput";
import { TypingIndicator } from "@/src/components/chat/TypingIndicator";
import { MessageActions } from "@/src/components/chat/MessageActions";
import { ReplyPreview } from "@/src/components/chat/ReplyPreview";
import { PinnedBanner } from "@/src/components/chat/PinnedBanner";
import { PinnedMessagesSheet } from "@/src/components/chat/PinnedMessagesSheet";
import { ScheduleSheet } from "@/src/components/chat/ScheduleSheet";
import { ScheduledMessagesSheet } from "@/src/components/chat/ScheduledMessagesSheet";
import { UndoSendBar } from "@/src/components/chat/UndoSendBar";
import { Icon } from "@/src/components/ui/Icon";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";
import { Dialog } from "@/src/components/ui/Dialog";
import { Button } from "@/src/components/ui/Button";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { Message, ScheduledMessage } from "@/src/types";

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
    loadMore,
    undoableMessage,
    undoSend,
  } = useMessages(roomId!);
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(roomId!);

  const inputRef = useRef<MessageInputHandle>(null);

  const [roomName, setRoomName] = useState("");
  const [roomAvatar, setRoomAvatar] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(0);

  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [chatError, setChatError] = useState("");

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

  useEffect(() => {
    if (!roomId || !user) return;

    roomService.getRoomParticipants(roomId).then((participants) => {
      setParticipantCount(participants.length);

      const otherParticipant = participants.find(
        (p) => p.user_id !== user.id
      );
      if (otherParticipant?.profiles) {
        const { profiles: otherProfile } = otherParticipant;
        setRoomName(otherProfile.display_name || otherProfile.username);
        setRoomAvatar(otherProfile.avatar_url);
      }
    });
  }, [roomId, user]);

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

  const handleLongPress = useCallback((message: Message) => {
    setSelectedMessage(message);
    setShowActions(true);
  }, []);

  const handleReply = useCallback((message: Message) => {
    setReplyTo(message);
  }, []);

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
      if (recalled) inputRef.current?.setText(recalled);
    } catch {
      setChatError(t("undo.failed"));
    }
  }, [undoSend, t]);

  const handleLongPressSend = useCallback((content: string) => {
    setScheduleDraft(content);
  }, []);

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
        inputRef.current?.setText(draft);
        setChatError(t("schedule.failed"));
      }
    },
    [user, roomId, scheduleDraft, replyTo, t]
  );

  const handleScheduleClose = useCallback(() => {
    // Dismissed without picking — hand the draft back to the composer
    if (scheduleDraft) inputRef.current?.setText(scheduleDraft);
    setScheduleDraft(null);
  }, [scheduleDraft]);

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

      if (replyTo) {
        if (!user) return;
        try {
          await messageService.sendMessage({
            room_id: roomId!,
            sender_id: user.id,
            content: content.trim(),
            type: "text",
            reply_to: replyTo.id,
          });
        } catch (err: unknown) {
          console.error("[ChatScreen] send reply", err);
          const msg =
            err instanceof Error ? err.message : t("message.sendFailed");
          setChatError(msg);
        }
        setReplyTo(null);
      } else {
        sendMessage(content);
      }
    },
    [replyTo, sendMessage, roomId, user, chatError]
  );

  const handleAttach = useCallback(async () => {
    if (!user || !roomId) return;
    if (chatError) setChatError("");

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setChatError(t("errors:mediaLibraryPermission"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });

    if (result.canceled) return;

    try {
      await messageService.sendImageMessage(
        roomId,
        user.id,
        result.assets[0].uri
      );
    } catch (err: unknown) {
      console.error("[ChatScreen] send image", err);
      const msg =
        err instanceof Error
          ? t("message.sendImageFailedDetail", { message: err.message })
          : t("message.sendImageFailed");
      setChatError(msg);
    }
  }, [roomId, user, chatError]);

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
          participantCount={participantCount}
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
          onLoadMore={loadMore}
          onMessageLongPress={handleLongPress}
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
        <MessageInput
          ref={inputRef}
          onSend={handleSend}
          onAttach={handleAttach}
          onLongPressSend={handleLongPressSend}
          onTypingStart={startTyping}
          onTypingStop={stopTyping}
        />
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

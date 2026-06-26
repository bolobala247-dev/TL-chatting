import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { useMessages } from "@/src/hooks/useMessages";
import { useTypingIndicator } from "@/src/hooks/useTypingIndicator";
import { roomService } from "@/src/services/roomService";
import { messageService } from "@/src/services/messageService";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { ChatHeader } from "@/src/components/chat/ChatHeader";
import { MessageList } from "@/src/components/chat/MessageList";
import { MessageInput } from "@/src/components/chat/MessageInput";
import { TypingIndicator } from "@/src/components/chat/TypingIndicator";
import { MessageActions } from "@/src/components/chat/MessageActions";
import { ReplyPreview } from "@/src/components/chat/ReplyPreview";
import { LoadingSpinner } from "@/src/components/ui/LoadingSpinner";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";
import type { Message, Profile } from "@/src/types";

export default function ChatScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const updateMessageInStore = useChatStore((s) => s.updateMessage);
  const { messages, loading, hasMore, sendMessage, loadMore } =
    useMessages(roomId!);
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(roomId!);

  const [roomName, setRoomName] = useState("Chat");
  const [roomAvatar, setRoomAvatar] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(0);

  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [chatError, setChatError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState("");

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
      setEditError("Nội dung tin nhắn không được để trống");
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
        err instanceof Error ? err.message : "Không thể chỉnh sửa tin nhắn";
      setEditError(msg);
    }
  };

  const handleDelete = useCallback((message: Message) => {
    setDeleteTarget(message);
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    const target = deleteTarget;
    setDeleteTarget(null);

    try {
      await messageService.deleteMessage(target.id);
      removeMessage(target.id, roomId!);
    } catch (err: unknown) {
      console.error("[ChatScreen] delete message", err);
      const msg =
        err instanceof Error ? err.message : "Không thể xoá tin nhắn";
      setChatError(msg);
    }
  };

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
            err instanceof Error ? err.message : "Không thể gửi tin nhắn";
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
      setChatError("Cần quyền truy cập thư viện ảnh");
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
          ? `Không thể gửi ảnh: ${err.message}`
          : "Không thể gửi ảnh";
      setChatError(msg);
    }
  }, [roomId, user, chatError]);

  if (!roomId) {
    return <LoadingSpinner fullScreen />;
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ paddingTop: insets.top }}>
        <ChatHeader
          name={roomName}
          avatarUrl={roomAvatar}
          participantCount={participantCount}
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

      <View style={{ paddingBottom: insets.bottom }}>
        <TypingIndicator typingUsers={typingUsers} />
        {chatError ? (
          <View className="border-t border-red-100 bg-red-50 px-4 py-2">
            <Text className="text-sm text-red-600">{chatError}</Text>
          </View>
        ) : null}
        {replyTo && (
          <ReplyPreview
            message={replyTo}
            onDismiss={() => setReplyTo(null)}
          />
        )}
        <MessageInput
          onSend={handleSend}
          onAttach={handleAttach}
          onTypingStart={startTyping}
          onTypingStop={stopTyping}
        />
      </View>

      <MessageActions
        message={selectedMessage}
        visible={showActions}
        onClose={() => setShowActions(false)}
        onReply={handleReply}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <ConfirmDialog
        visible={!!deleteTarget}
        title="Xoá tin nhắn"
        message="Bạn có chắc muốn xoá tin nhắn này?"
        confirmText="Xoá"
        cancelText="Huỷ"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal
        visible={!!editingMessage}
        transparent
        animationType="fade"
        onRequestClose={() => setEditingMessage(null)}
      >
        <Pressable
          className="flex-1 items-center justify-center bg-black/50 px-6"
          onPress={() => setEditingMessage(null)}
        >
          <Pressable
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-lg font-bold text-gray-900">
              Chỉnh sửa tin nhắn
            </Text>
            <TextInput
              className={`mt-4 min-h-[88px] rounded-xl border bg-gray-50 px-4 py-3 text-base text-gray-900 ${
                editError ? "border-red-500" : "border-gray-300"
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
              <Text className="mt-2 text-sm text-red-600">{editError}</Text>
            ) : null}
            <View className="mt-6 flex-row justify-end gap-3">
              <Pressable
                className="rounded-xl bg-gray-100 px-5 py-3 active:bg-gray-200"
                onPress={() => setEditingMessage(null)}
              >
                <Text className="text-sm font-semibold text-gray-700">
                  Huỷ
                </Text>
              </Pressable>
              <Pressable
                className="rounded-xl bg-primary-600 px-5 py-3 active:bg-primary-700"
                onPress={confirmEdit}
              >
                <Text className="text-sm font-semibold text-white">
                  Lưu
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

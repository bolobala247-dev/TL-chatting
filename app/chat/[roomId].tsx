import { useEffect, useState, useCallback } from "react";
import { View, KeyboardAvoidingView, Platform, Alert } from "react-native";
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

  const handleEdit = useCallback(
    async (message: Message) => {
      Alert.prompt?.(
        "Chỉnh sửa tin nhắn",
        undefined,
        async (newContent: string) => {
          if (!newContent.trim()) return;
          try {
            const updated = await messageService.updateMessage(
              message.id,
              newContent.trim()
            );
            updateMessageInStore(updated);
          } catch (error: any) {
            Alert.alert("Lỗi", error.message);
          }
        },
        "plain-text",
        message.content || ""
      );
    },
    [updateMessageInStore]
  );

  const handleDelete = useCallback(
    async (message: Message) => {
      Alert.alert(
        "Xoá tin nhắn",
        "Bạn có chắc muốn xoá tin nhắn này?",
        [
          { text: "Huỷ", style: "cancel" },
          {
            text: "Xoá",
            style: "destructive",
            onPress: async () => {
              try {
                await messageService.deleteMessage(message.id);
                removeMessage(message.id, roomId!);
              } catch (error: any) {
                Alert.alert("Lỗi", error.message);
              }
            },
          },
        ]
      );
    },
    [roomId, removeMessage]
  );

  const handleSend = useCallback(
    async (content: string) => {
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
        } catch (error: any) {
          Alert.alert("Lỗi", error.message);
        }
        setReplyTo(null);
      } else {
        sendMessage(content);
      }
    },
    [replyTo, sendMessage, roomId, user]
  );

  const handleAttach = useCallback(async () => {
    if (!user || !roomId) return;

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Lỗi", "Cần quyền truy cập thư viện ảnh");
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
    } catch (error: any) {
      Alert.alert("Lỗi", `Không thể gửi ảnh: ${error.message}`);
    }
  }, [roomId, user]);

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
    </KeyboardAvoidingView>
  );
}

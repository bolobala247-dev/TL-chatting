import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import type { Message } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";

interface MessageBubbleProps {
  message: Message;
  onLongPress?: (message: Message) => void;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ReplyContext({ replyToId, roomId }: { replyToId: string; roomId: string }) {
  const messages = useChatStore((s) => s.messages[roomId] ?? []);
  const replyMessage = messages.find((m) => m.id === replyToId);

  if (!replyMessage) return null;

  return (
    <View className="mb-1.5 rounded-lg border-l-2 border-primary-300 bg-black/5 px-2.5 py-1.5">
      <Text className="text-xs text-gray-500" numberOfLines={1}>
        {replyMessage.content || "[Hình ảnh]"}
      </Text>
    </View>
  );
}

export function MessageBubble({ message, onLongPress }: MessageBubbleProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const isMine = message.sender_id === userId;

  if (message.type === "system") {
    return (
      <View className="my-1 items-center px-4">
        <Text className="text-xs text-gray-400">{message.content}</Text>
      </View>
    );
  }

  return (
    <Pressable
      className={`my-0.5 max-w-[80%] px-3 ${isMine ? "self-end" : "self-start"}`}
      onLongPress={() => onLongPress?.(message)}
      delayLongPress={300}
    >
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          isMine
            ? "rounded-br-md bg-primary-600"
            : "rounded-bl-md bg-gray-100"
        }`}
      >
        {message.reply_to && (
          <ReplyContext replyToId={message.reply_to} roomId={message.room_id} />
        )}

        {message.type === "image" && message.media_url && (
          <View className="mb-1 overflow-hidden rounded-xl">
            <Image
              source={{ uri: message.media_url }}
              style={{ width: 220, height: 180 }}
              contentFit="cover"
              transition={200}
            />
          </View>
        )}

        {message.content && (
          <Text
            className={`text-[15px] leading-5 ${
              isMine ? "text-white" : "text-gray-900"
            }`}
          >
            {message.content}
          </Text>
        )}

        <View
          className={`mt-1 flex-row items-center gap-1 ${isMine ? "justify-end" : ""}`}
        >
          <Text
            className={`text-[10px] ${
              isMine ? "text-blue-200" : "text-gray-400"
            }`}
          >
            {formatTime(message.created_at)}
          </Text>
          {message.is_edited && (
            <Text
              className={`text-[10px] ${
                isMine ? "text-blue-200" : "text-gray-400"
              }`}
            >
              (đã sửa)
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

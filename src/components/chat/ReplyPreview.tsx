import { View, Text, Pressable } from "react-native";
import { SymbolView } from "expo-symbols";
import type { Message } from "@/src/types";

interface ReplyPreviewProps {
  message: Message;
  onDismiss: () => void;
}

export function ReplyPreview({ message, onDismiss }: ReplyPreviewProps) {
  return (
    <View className="flex-row items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-2">
      <View className="w-0.5 self-stretch rounded-full bg-primary-500" />
      <View className="flex-1">
        <Text className="text-xs font-medium text-primary-600">
          Trả lời tin nhắn
        </Text>
        <Text className="text-sm text-gray-500" numberOfLines={1}>
          {message.content || "[Hình ảnh]"}
        </Text>
      </View>
      <Pressable onPress={onDismiss} className="p-1 active:opacity-50">
        <SymbolView
          name={{ ios: "xmark", android: "close", web: "close" }}
          tintColor="#9CA3AF"
          size={16}
        />
      </Pressable>
    </View>
  );
}

import { useCallback } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { MessageBubble } from "./MessageBubble";
import type { Message } from "@/src/types";

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onMessageLongPress?: (message: Message) => void;
}

export function MessageList({
  messages,
  loading,
  hasMore,
  onLoadMore,
  onMessageLongPress,
}: MessageListProps) {
  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble message={item} onLongPress={onMessageLongPress} />
    ),
    [onMessageLongPress]
  );

  const renderFooter = useCallback(() => {
    if (!loading || messages.length === 0) return null;
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color="#3B82F6" />
      </View>
    );
  }, [loading, messages.length]);

  const renderEmpty = useCallback(() => {
    if (loading) {
      return (
        <View
          className="flex-1 items-center justify-center"
          style={{ transform: [{ scaleY: -1 }] }}
        >
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      );
    }
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ transform: [{ scaleY: -1 }] }}
      >
        <Text className="text-base text-gray-400">
          Chưa có tin nhắn nào
        </Text>
        <Text className="mt-1 text-sm text-gray-300">
          Hãy bắt đầu cuộc trò chuyện!
        </Text>
      </View>
    );
  }, [loading]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  return (
    <FlatList
      data={messages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      inverted
      onEndReached={hasMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.5}
      ListFooterComponent={renderFooter}
      ListEmptyComponent={renderEmpty}
      contentContainerStyle={
        messages.length === 0
          ? { flex: 1, paddingVertical: 8 }
          : { paddingVertical: 8 }
      }
      maxToRenderPerBatch={15}
      windowSize={10}
      removeClippedSubviews
    />
  );
}

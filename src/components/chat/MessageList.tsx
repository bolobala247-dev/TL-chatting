import { useCallback } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { MessageBubble } from "./MessageBubble";
import { useThemeColors } from "@/src/theme";
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
  const { t } = useTranslation("chat");
  const colors = useThemeColors();
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
        <ActivityIndicator size="small" color={colors.fgTertiary} />
      </View>
    );
  }, [loading, messages.length, colors.fgTertiary]);

  const renderEmpty = useCallback(() => {
    if (loading) {
      return (
        <View
          className="flex-1 items-center justify-center"
          style={{ transform: [{ scaleY: -1 }] }}
        >
          <ActivityIndicator size="large" color={colors.fgTertiary} />
        </View>
      );
    }
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ transform: [{ scaleY: -1 }] }}
      >
        <Text className="font-sans-semibold text-title text-fg">
          {t("message.emptyTitle")}
        </Text>
        <Text className="mt-1 font-sans text-caption text-fg-tertiary">
          {t("message.emptyCta")}
        </Text>
      </View>
    );
  }, [loading, t, colors.fgTertiary]);

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

import { useCallback, useMemo } from "react";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { FlashList } from "@shopify/flash-list";
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

  // Store keeps messages newest-first (legacy inverted-list order);
  // FlashList v2 renders chat bottom-up from chronological data instead.
  const orderedMessages = useMemo(
    () => [...messages].reverse(),
    [messages]
  );

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble message={item} onLongPress={onMessageLongPress} />
    ),
    [onMessageLongPress]
  );

  const renderHeader = useCallback(() => {
    if (!loading || messages.length === 0) return null;
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color={colors.fgTertiary} />
      </View>
    );
  }, [loading, messages.length, colors.fgTertiary]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  // FlashList does not support flex styles in contentContainerStyle,
  // so the loading/empty states render outside the list.
  if (messages.length === 0) {
    if (loading) {
      return (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.fgTertiary} />
        </View>
      );
    }
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="font-sans-semibold text-title text-fg">
          {t("message.emptyTitle")}
        </Text>
        <Text className="mt-1 font-sans text-caption text-fg-tertiary">
          {t("message.emptyCta")}
        </Text>
      </View>
    );
  }

  return (
    <FlashList
      data={orderedMessages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: true,
        autoscrollToBottomThreshold: 0.2,
      }}
      onStartReached={hasMore ? onLoadMore : undefined}
      onStartReachedThreshold={0.2}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={{ paddingVertical: 8 }}
      // iOS: drag the keyboard down interactively; Android: dismiss on scroll
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
    />
  );
}

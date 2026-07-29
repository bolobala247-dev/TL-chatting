import { useCallback, useMemo } from "react";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { FlashList } from "@shopify/flash-list";
import { MessageBubble } from "./MessageBubble";
import { useThemeColors } from "@/src/theme";
import type { MessageWithMeta, RoomParticipantWithProfile } from "@/src/types";

interface MessageListProps {
  messages: MessageWithMeta[];
  loading: boolean;
  hasMore: boolean;
  /** Watermarks for receipt ticks; identity changes on realtime updates. */
  participants?: RoomParticipantWithProfile[];
  /** Group rooms expose the poll voters list. */
  showPollVoters?: boolean;
  onLoadMore: () => void;
  onMessageLongPress?: (message: MessageWithMeta) => void;
  onToggleReaction?: (message: MessageWithMeta, emoji: string) => void;
  onShowReactions?: (message: MessageWithMeta) => void;
  onOpenAlbum?: (message: MessageWithMeta, index: number) => void;
  onVote?: (message: MessageWithMeta, optionIndex: number) => void;
  onViewVoters?: (message: MessageWithMeta) => void;
  onOpenThread?: (message: MessageWithMeta) => void;
}

export function MessageList({
  messages,
  loading,
  hasMore,
  participants,
  showPollVoters,
  onLoadMore,
  onMessageLongPress,
  onToggleReaction,
  onShowReactions,
  onOpenAlbum,
  onVote,
  onViewVoters,
  onOpenThread,
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
    ({ item }: { item: MessageWithMeta }) => (
      <MessageBubble
        message={item}
        participants={participants}
        showPollVoters={showPollVoters}
        onLongPress={onMessageLongPress}
        onToggleReaction={onToggleReaction}
        onShowReactions={onShowReactions}
        onOpenAlbum={onOpenAlbum}
        onVote={onVote}
        onViewVoters={onViewVoters}
        onOpenThread={onOpenThread}
      />
    ),
    [
      participants,
      showPollVoters,
      onMessageLongPress,
      onToggleReaction,
      onShowReactions,
      onOpenAlbum,
      onVote,
      onViewVoters,
      onOpenThread,
    ]
  );

  const renderHeader = useCallback(() => {
    if (!loading || messages.length === 0) return null;
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color={colors.fgTertiary} />
      </View>
    );
  }, [loading, messages.length, colors.fgTertiary]);

  const keyExtractor = useCallback((item: MessageWithMeta) => item.id, []);

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
      extraData={participants}
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

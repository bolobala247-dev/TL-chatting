import { memo, useCallback, useMemo } from "react";
import { View, Text, ActivityIndicator, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { FlashList } from "@shopify/flash-list";
import { MessageBubble } from "./MessageBubble";
import { useAuthStore } from "@/src/stores/authStore";
import { getSeenWatermark } from "@/src/lib/receipts";
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
  /** Swipe-to-reply on a bubble (native only). */
  onSwipeReply?: (message: MessageWithMeta) => void;
  onToggleReaction?: (message: MessageWithMeta, emoji: string) => void;
  onShowReactions?: (message: MessageWithMeta) => void;
  onOpenAlbum?: (message: MessageWithMeta, index: number) => void;
  onVote?: (message: MessageWithMeta, optionIndex: number) => void;
  onViewVoters?: (message: MessageWithMeta) => void;
}

// Memoized: the chat screen re-renders on every composer keystroke; stable
// props (store arrays + useCallback handlers) let the whole list skip those
export const MessageList = memo(function MessageList({
  messages,
  loading,
  hasMore,
  participants,
  showPollVoters,
  onLoadMore,
  onMessageLongPress,
  onSwipeReply,
  onToggleReaction,
  onShowReactions,
  onOpenAlbum,
  onVote,
  onViewVoters,
}: MessageListProps) {
  const { t } = useTranslation("chat");
  const colors = useThemeColors();
  const userId = useAuthStore((s) => s.user?.id);

  // Store keeps messages newest-first (legacy inverted-list order);
  // FlashList v2 renders chat bottom-up from chronological data instead.
  const orderedMessages = useMemo(
    () => [...messages].reverse(),
    [messages]
  );

  // Collapse participant watermarks into one stable string so memoized
  // bubbles only re-render when a peer's read position actually moves
  const seenWatermark = useMemo(
    () => getSeenWatermark(participants ?? [], userId),
    [participants, userId]
  );

  const renderItem = useCallback(
    ({ item }: { item: MessageWithMeta }) => (
      <MessageBubble
        message={item}
        seenWatermark={seenWatermark}
        showPollVoters={showPollVoters}
        onLongPress={onMessageLongPress}
        onSwipeReply={onSwipeReply}
        onToggleReaction={onToggleReaction}
        onShowReactions={onShowReactions}
        onOpenAlbum={onOpenAlbum}
        onVote={onVote}
        onViewVoters={onViewVoters}
      />
    ),
    [
      seenWatermark,
      showPollVoters,
      onMessageLongPress,
      onSwipeReply,
      onToggleReaction,
      onShowReactions,
      onOpenAlbum,
      onVote,
      onViewVoters,
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
      extraData={seenWatermark}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: true,
        autoscrollToBottomThreshold: 0.2,
      }}
      onStartReached={hasMore ? onLoadMore : undefined}
      onStartReachedThreshold={0.2}
      ListHeaderComponent={renderHeader}
      contentContainerStyle={{ paddingVertical: 8 }}
      showsVerticalScrollIndicator={false}
      // iOS: drag the keyboard down interactively; Android: dismiss on scroll
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      keyboardShouldPersistTaps="handled"
    />
  );
});

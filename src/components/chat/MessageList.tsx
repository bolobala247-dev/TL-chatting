import { memo, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewabilityConfig,
} from "react-native";
import { useTranslation } from "react-i18next";
import { FlashList, type FlashListRef, type ViewToken } from "@shopify/flash-list";
import { MessageBubble, type MessageLayout } from "./MessageBubble";
import { DateSeparator } from "./DateSeparator";
import { useAuthStore } from "@/src/stores/authStore";
import { isSameCalendarDay } from "@/src/lib/formatDate";
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
  onMessageLongPress?: (message: MessageWithMeta, layout?: MessageLayout) => void;
  /** Swipe-to-reply on a bubble (native only). */
  onSwipeReply?: (message: MessageWithMeta) => void;
  onToggleReaction?: (message: MessageWithMeta, emoji: string) => void;
  onShowReactions?: (message: MessageWithMeta) => void;
  onOpenAlbum?: (message: MessageWithMeta, index: number) => void;
  onVote?: (message: MessageWithMeta, optionIndex: number) => void;
  onViewVoters?: (message: MessageWithMeta) => void;
  /** Re-attempt a failed send (Phase 5A outbox). */
  onRetryMessage?: (message: MessageWithMeta) => void;
  /** Discard a pending/failed send (Phase 5A outbox). */
  onDiscardMessage?: (message: MessageWithMeta) => void;
  // --- Phase 9 scroll restoration (all optional; undefined ⇒ today's behavior) ---
  /** Imperative handle for scroll-to-index/end from the scroll manager. */
  listRef?: React.Ref<FlashListRef<MessageWithMeta>>;
  /** Rendered index to open at (restore / focus jump); undefined ⇒ bottom. */
  initialScrollIndex?: number;
  /** Scroll position sampler (drives the pill + durable anchor flush). */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Records the topmost visible message as the anchor candidate. */
  onViewableItemsChanged?: (info: {
    viewableItems: ViewToken<MessageWithMeta>[];
  }) => void;
  /** Viewability thresholds (stable identity required by FlashList). */
  viewabilityConfig?: ViewabilityConfig;
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
  onRetryMessage,
  onDiscardMessage,
  listRef,
  initialScrollIndex,
  onScroll,
  onViewableItemsChanged,
  viewabilityConfig,
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
    ({ item, index }: { item: MessageWithMeta; index: number }) => {
      const prev = index > 0 ? orderedMessages[index - 1] : null;
      const showDate =
        !!item.created_at &&
        (!prev?.created_at ||
          !isSameCalendarDay(prev.created_at, item.created_at));

      return (
        <>
          {showDate ? <DateSeparator dateStr={item.created_at!} /> : null}
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
            onRetry={onRetryMessage}
            onDiscard={onDiscardMessage}
          />
        </>
      );
    },
    [
      orderedMessages,
      seenWatermark,
      showPollVoters,
      onMessageLongPress,
      onSwipeReply,
      onToggleReaction,
      onShowReactions,
      onOpenAlbum,
      onVote,
      onViewVoters,
      onRetryMessage,
      onDiscardMessage,
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

  // Recycling pools per message type: a text bubble is never recycled into
  // an image/poll layout, avoiding expensive re-layout on scroll
  const getItemType = useCallback(
    (item: MessageWithMeta) => item.type ?? "text",
    []
  );

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
      ref={listRef}
      data={orderedMessages}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      extraData={seenWatermark}
      initialScrollIndex={initialScrollIndex}
      onScroll={onScroll}
      scrollEventThrottle={onScroll ? 16 : undefined}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: true,
        autoscrollToBottomThreshold: 0.2,
        // Keyboard open shrinks the list; an animated auto-scroll on top of
        // the keyboard animation reads as lag — snap to bottom instantly
        animateAutoScrollToBottom: false,
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

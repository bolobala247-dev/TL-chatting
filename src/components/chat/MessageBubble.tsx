import { memo, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  Linking,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import type { MessageWithMeta } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { useJumpStore } from "@/src/stores/jumpStore";
import { jumpBus } from "@/src/lib/jumpBus";
import {
  FEATURE_SCROLL_TO_MESSAGE,
  JUMP_HIGHLIGHT_DURATION_MS,
  JUMP_HIGHLIGHT_FADE_IN_MS,
  JUMP_HIGHLIGHT_FADE_OUT_MS,
} from "@/src/lib/constants";
import { useThemeColors } from "@/src/theme";
import { getAttachments } from "@/src/lib/messageMeta";
import { seenByAllAt } from "@/src/lib/receipts";
import { getMentions, splitByMentions } from "@/src/lib/mentions";
import { hapticImpact, hapticSelection } from "@/src/lib/haptics";
import { Icon } from "@/src/components/ui/Icon";
import { ReactionBar } from "./ReactionBar";
import { AlbumGrid } from "./AlbumGrid";
import { PollBubble } from "./PollBubble";

interface MessageBubbleProps {
  message: MessageWithMeta;
  /** Seen-by-all watermark (min other last_read_at) — drives the own-message receipt ticks. */
  seenWatermark?: string | null;
  /** Group rooms expose the poll voters list. */
  showPollVoters?: boolean;
  onLongPress?: (message: MessageWithMeta, layout?: MessageLayout) => void;
  /** Swipe the bubble toward the center to quote-reply (native only). */
  onSwipeReply?: (message: MessageWithMeta) => void;
  onToggleReaction?: (message: MessageWithMeta, emoji: string) => void;
  onShowReactions?: (message: MessageWithMeta) => void;
  onOpenAlbum?: (message: MessageWithMeta, index: number) => void;
  onVote?: (message: MessageWithMeta, optionIndex: number) => void;
  onViewVoters?: (message: MessageWithMeta) => void;
  /** Re-attempt a failed send (Phase 5A outbox). */
  onRetry?: (message: MessageWithMeta) => void;
  /** Discard a pending/failed send without sending (Phase 5A outbox). */
  onDiscard?: (message: MessageWithMeta) => void;
}

export interface MessageLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Drag distance that arms the swipe-to-reply on release. */
const REPLY_TRIGGER_DISTANCE = 56;
/** Maximum bubble drag — soft stop just past the trigger point. */
const REPLY_MAX_DRAG = 88;
/** Bubbles stop growing past this width on tablets. */
const BUBBLE_MAX_WIDTH = 560;

function formatTime(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function ReplyContext({ replyToId, roomId }: { replyToId: string; roomId: string }) {
  const { t } = useTranslation("chat");
  // Select the quoted message itself (stable reference): appending other
  // messages to the room does not re-render this preview
  const replyMessage = useChatStore((s) =>
    s.messages[roomId]?.find((m) => m.id === replyToId)
  );

  if (!replyMessage) return null;

  const preview = replyMessage.deleted_at
    ? t("message.deleted")
    : replyMessage.content || t("message.imagePlaceholder");

  // Phase 11 §2: tapping the quoted preview jumps to the original message via
  // the shared pipeline. Flag-off ⇒ disabled, so this renders/behaves as before.
  const handleJump = FEATURE_SCROLL_TO_MESSAGE
    ? () =>
        jumpBus.request({
          roomId,
          messageId: replyToId,
          createdAt: replyMessage.created_at ?? undefined,
          source: "reply",
        })
    : undefined;

  return (
    <Pressable
      onPress={handleJump}
      disabled={!FEATURE_SCROLL_TO_MESSAGE}
      className="mb-1.5 rounded-lg border-l-2 border-border bg-ink/5 px-2.5 py-1.5"
    >
      <Text className="font-sans text-label text-fg-tertiary" numberOfLines={1}>
        {preview}
      </Text>
    </Pressable>
  );
}

// Memoized: message object identity changes on any patch, so memo keeps
// FlashList re-renders cheap while reactions/votes/receipts update live
export const MessageBubble = memo(function MessageBubble({
  message,
  seenWatermark,
  showPollVoters,
  onLongPress,
  onSwipeReply,
  onToggleReaction,
  onShowReactions,
  onOpenAlbum,
  onVote,
  onViewVoters,
  onRetry,
  onDiscard,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation("chat");
  const userId = useAuthStore((s) => s.user?.id);
  const { width: screenWidth } = useWindowDimensions();
  const isMine = message.sender_id === userId;
  const isDeleted = !!message.deleted_at;
  const isPoll = message.type === "poll";
  const bubbleRef = useRef<View>(null);
  // Phase 5A send state (own messages only; undefined = normal sent message)
  const isPending = message.outbox_status === "pending";
  const isFailed = message.outbox_status === "failed";
  // Phase 7B: per-message upload progress (done/total) while the media plane
  // uploads; undefined for text/poll and after the completion gate.
  const uploadProgress = useChatStore((s) => s.uploadProgress[message.id]);

  // Phase 11 §7: one-shot highlight when this bubble is the jump target. The
  // selector returns 0 for every other bubble (stable ⇒ no re-render); only the
  // target re-renders when its token changes, and a fresh token re-pulses it.
  const colors = useThemeColors();
  const highlightToken = useJumpStore((s) => {
    const h = s.highlightByRoom[message.room_id];
    return h && h.messageId === message.id ? h.token : 0;
  });
  const highlight = useSharedValue(0);
  useEffect(() => {
    if (!highlightToken) return;
    highlight.value = withSequence(
      withTiming(1, { duration: JUMP_HIGHLIGHT_FADE_IN_MS }),
      withDelay(
        Math.max(
          0,
          JUMP_HIGHLIGHT_DURATION_MS -
            JUMP_HIGHLIGHT_FADE_IN_MS -
            JUMP_HIGHLIGHT_FADE_OUT_MS
        ),
        withTiming(0, { duration: JUMP_HIGHLIGHT_FADE_OUT_MS })
      )
    );
  }, [highlightToken, highlight]);
  const highlightStyle = useAnimatedStyle(() => ({
    opacity: highlight.value * 0.18,
  }));

  // Swipe-to-reply: drag the bubble toward the center, release past the
  // threshold to quote — a touch idiom, so web keeps taps only
  const dragX = useSharedValue(0);
  const canSwipeReply =
    Platform.OS !== "web" &&
    !!onSwipeReply &&
    !isDeleted &&
    !isPending &&
    !isFailed &&
    !message.id.startsWith("temp-");

  const triggerReply = useCallback(() => {
    hapticSelection();
    onSwipeReply?.(message);
  }, [onSwipeReply, message]);

  // Incoming bubbles swipe right, own bubbles swipe left (toward center)
  const dir = isMine ? -1 : 1;
  const replyPan = Gesture.Pan()
    .enabled(canSwipeReply)
    .activeOffsetX(isMine ? [-16, 10000] : [-10000, 16])
    .failOffsetY([-12, 12])
    .onChange((e) => {
      const progress = Math.min(Math.max(e.translationX * dir, 0), REPLY_MAX_DRAG);
      dragX.value = progress * dir;
    })
    .onEnd(() => {
      if (Math.abs(dragX.value) >= REPLY_TRIGGER_DISTANCE) {
        runOnJS(triggerReply)();
      }
      dragX.value = withSpring(0, { damping: 22, stiffness: 320 });
    });

  const bubbleDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }],
  }));

  const replyHintStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.abs(dragX.value) / REPLY_TRIGGER_DISTANCE, 1),
  }));

  const albumImages =
    !isDeleted && message.type === "image" ? getAttachments(message) : [];
  const mentions = isDeleted ? [] : getMentions(message);

  // Receipt ticks: one check = sent, two = seen by every other participant.
  // Suppressed while a send is pending/failed — the status affordance shows instead.
  const showReceipt =
    isMine &&
    !isDeleted &&
    !isPending &&
    !isFailed &&
    !message.id.startsWith("temp-");
  const seenByAll =
    showReceipt && seenByAllAt(seenWatermark, message.created_at);

  if (message.type === "system") {
    return (
      <View className="my-1 items-center px-4">
        <Text className="font-sans text-label text-fg-tertiary">{message.content}</Text>
      </View>
    );
  }

  // Tablets: 80% of a large screen is too wide for comfortable reading
  const bubbleMaxWidth =
    Platform.OS !== "web" && screenWidth >= 768 ? BUBBLE_MAX_WIDTH : undefined;

  return (
    <Pressable
      ref={bubbleRef}
      className={`my-0.5 max-w-[80%] px-3 ${isMine ? "self-end" : "self-start"}`}
      style={bubbleMaxWidth != null ? { maxWidth: bubbleMaxWidth } : undefined}
      onLongPress={
        isDeleted
          ? undefined
          : () => {
              hapticImpact();
              const bubble = bubbleRef.current;
              if (bubble?.measureInWindow) {
                bubble.measureInWindow((x, y, width, height) => {
                  onLongPress?.(message, { x, y, width, height });
                });
              } else {
                onLongPress?.(message);
              }
            }
      }
      delayLongPress={300}
    >
      {canSwipeReply && (
        <Animated.View
          pointerEvents="none"
          style={[
            replyHintStyle,
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              justifyContent: "center",
              ...(isMine ? { right: 12 } : { left: 12 }),
            },
          ]}
        >
          <Icon
            name={{
              ios: "arrowshape.turn.up.left",
              android: "reply",
              web: "reply",
            }}
            tone="tertiary"
            size="sm"
          />
        </Animated.View>
      )}

      <GestureDetector gesture={replyPan}>
        <Animated.View style={bubbleDragStyle}>
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          isMine
            ? "rounded-br-md bg-ink"
            : "rounded-bl-md bg-surface-secondary border border-border"
        }`}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            highlightStyle,
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: 16,
              backgroundColor: colors.info,
            },
          ]}
        />
        {!isDeleted && message.reply_to && (
          <ReplyContext replyToId={message.reply_to} roomId={message.room_id} />
        )}

        {isDeleted ? (
          <Text
            className={`font-sans italic text-body leading-5 ${
              isMine ? "text-ink-inverse/70" : "text-fg-tertiary"
            }`}
          >
            {t("message.deleted")}
          </Text>
        ) : (
          <>
            {message.type === "image" && albumImages.length > 0 && (
              <AlbumGrid
                attachments={albumImages}
                onPressImage={(index) => onOpenAlbum?.(message, index)}
              />
            )}

            {isPoll && (
              <PollBubble
                message={message}
                isMine={isMine}
                currentUserId={userId}
                showViewVotes={showPollVoters}
                onVote={(m, index) => onVote?.(m, index)}
                onViewVoters={(m) => onViewVoters?.(m)}
              />
            )}

            {(message.type === "video" || message.type === "file") &&
              message.media_url && (
                <Pressable
                  className={`mb-1 flex-row items-center gap-2 rounded-xl px-3 py-2.5 ${
                    isMine ? "bg-ink-inverse/10" : "bg-ink/5"
                  }`}
                  onPress={() => Linking.openURL(message.media_url!)}
                  accessibilityRole="button"
                >
                  <Icon
                    name={
                      message.type === "video"
                        ? { ios: "play.circle.fill", android: "play_circle", web: "play_circle" }
                        : { ios: "doc.fill", android: "description", web: "description" }
                    }
                    tone={isMine ? "inverse" : "secondary"}
                    size="md"
                  />
                  <Text
                    className={`flex-1 font-sans text-body ${
                      isMine ? "text-ink-inverse" : "text-fg"
                    }`}
                    numberOfLines={1}
                  >
                    {message.type === "video"
                      ? t("message.videoPlaceholder")
                      : t("message.filePlaceholder")}
                  </Text>
                </Pressable>
              )}

            {message.content && !isPoll && (
              <Text
                className={`font-sans text-body leading-5 ${
                  isMine ? "text-ink-inverse" : "text-fg"
                }`}
              >
                {mentions.length > 0
                  ? splitByMentions(message.content, mentions).map(
                      (seg, i) =>
                        seg.isMention ? (
                          <Text
                            key={i}
                            className={`font-sans-semibold ${
                              isMine ? "text-ink-inverse" : "text-fg"
                            }`}
                          >
                            {seg.text}
                          </Text>
                        ) : (
                          seg.text
                        )
                    )
                  : message.content}
              </Text>
            )}
          </>
        )}

        <View
          className={`mt-1 flex-row items-center gap-1 ${isMine ? "justify-end" : ""}`}
        >
          <Text
            className={`font-sans text-micro ${
              isMine ? "text-ink-inverse/60" : "text-fg-tertiary"
            }`}
          >
            {message.created_at ? formatTime(message.created_at, i18n.language) : ""}
          </Text>
          {!isDeleted && message.is_edited && (
            <Text
              className={`font-sans text-micro ${
                isMine ? "text-ink-inverse/60" : "text-fg-tertiary"
              }`}
            >
              {t("message.edited")}
            </Text>
          )}
          {!isDeleted && message.pinned_at && (
            <Icon
              name={{ ios: "pin.fill", android: "keep", web: "keep" }}
              tone={isMine ? "inverse" : "tertiary"}
              size={11}
            />
          )}
          {showReceipt && (
            <View
              className="flex-row items-center"
              accessibilityLabel={t(
                seenByAll ? "receipts.seenByAll" : "receipts.sent"
              )}
            >
              <Icon
                name={{ ios: "checkmark", android: "check", web: "check" }}
                tone="inverse"
                size={11}
              />
              {seenByAll && (
                <View style={{ marginLeft: -7 }}>
                  <Icon
                    name={{ ios: "checkmark", android: "check", web: "check" }}
                    tone="inverse"
                    size={11}
                  />
                </View>
              )}
            </View>
          )}
          {isPending && (
            <View className="flex-row items-center gap-1">
              <Icon
                name={{ ios: "clock", android: "schedule", web: "schedule" }}
                tone="inverse"
                size={11}
              />
              <Text className="font-sans text-micro text-ink-inverse/60">
                {uploadProgress && uploadProgress.total > 0
                  ? `${t("message.sending")} ${uploadProgress.done}/${uploadProgress.total}`
                  : t("message.sending")}
              </Text>
            </View>
          )}
          {isFailed && (
            <View className="flex-row items-center gap-1.5">
              <Text className="font-sans text-micro text-ink-inverse/80">
                {t("message.sendError")}
              </Text>
              <Text className="text-micro text-ink-inverse/60">·</Text>
              <Pressable
                onPress={() => onRetry?.(message)}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text className="font-sans-medium text-micro text-ink-inverse underline">
                  {t("message.retry")}
                </Text>
              </Pressable>
              <Text className="text-micro text-ink-inverse/60">·</Text>
              <Pressable
                onPress={() => onDiscard?.(message)}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text className="font-sans-medium text-micro text-ink-inverse underline">
                  {t("message.discard")}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {!isDeleted && (message.message_reactions?.length ?? 0) > 0 && (
        <ReactionBar
          reactions={message.message_reactions!}
          isMine={isMine}
          currentUserId={userId}
          onToggle={(emoji) => onToggleReaction?.(message, emoji)}
          onOpenDetails={() => onShowReactions?.(message)}
        />
      )}
        </Animated.View>
      </GestureDetector>
    </Pressable>
  );
});

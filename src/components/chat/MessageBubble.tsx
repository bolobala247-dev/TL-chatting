import { memo } from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { useTranslation } from "react-i18next";
import type { MessageWithMeta, RoomParticipantWithProfile } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { hasSeen } from "@/src/lib/receipts";
import { getAttachments } from "@/src/lib/messageMeta";
import { getMentions, splitByMentions } from "@/src/lib/mentions";
import { Icon } from "@/src/components/ui/Icon";
import { ReactionBar } from "./ReactionBar";
import { AlbumGrid } from "./AlbumGrid";
import { PollBubble } from "./PollBubble";

interface MessageBubbleProps {
  message: MessageWithMeta;
  /** Room participants (watermarks) — drives the own-message receipt ticks. */
  participants?: RoomParticipantWithProfile[];
  /** Group rooms expose the poll voters list. */
  showPollVoters?: boolean;
  onLongPress?: (message: MessageWithMeta) => void;
  onToggleReaction?: (message: MessageWithMeta, emoji: string) => void;
  onShowReactions?: (message: MessageWithMeta) => void;
  onOpenAlbum?: (message: MessageWithMeta, index: number) => void;
  onVote?: (message: MessageWithMeta, optionIndex: number) => void;
  onViewVoters?: (message: MessageWithMeta) => void;
  onOpenThread?: (message: MessageWithMeta) => void;
}

function formatTime(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function ReplyContext({ replyToId, roomId }: { replyToId: string; roomId: string }) {
  const { t } = useTranslation("chat");
  const messages = useChatStore((s) => s.messages[roomId] ?? []);
  const replyMessage = messages.find((m) => m.id === replyToId);

  if (!replyMessage) return null;

  const preview = replyMessage.deleted_at
    ? t("message.deleted")
    : replyMessage.content || t("message.imagePlaceholder");

  return (
    <View className="mb-1.5 rounded-lg border-l-2 border-border bg-ink/5 px-2.5 py-1.5">
      <Text className="font-sans text-label text-fg-tertiary" numberOfLines={1}>
        {preview}
      </Text>
    </View>
  );
}

// Reply-count chip: counts loaded thread replies in the store (cheap,
// no extra query) — the thread screen fetches the full list.
function ThreadChip({
  message,
  isMine,
  onPress,
}: {
  message: MessageWithMeta;
  isMine: boolean;
  onPress?: () => void;
}) {
  const { t } = useTranslation("chat");
  const messages = useChatStore((s) => s.messages[message.room_id] ?? []);
  const replyCount = messages.filter((m) => m.thread_id === message.id).length;

  if (replyCount === 0) return null;

  return (
    <Pressable
      className="mt-1 flex-row items-center gap-1 self-start active:opacity-60"
      onPress={onPress}
      accessibilityRole="button"
    >
      <Icon
        name={{
          ios: "bubble.left.and.bubble.right",
          android: "forum",
          web: "forum",
        }}
        tone={isMine ? "inverse" : "tertiary"}
        size={12}
      />
      <Text
        className={`font-sans-medium text-label ${
          isMine ? "text-ink-inverse/80" : "text-fg-secondary"
        }`}
      >
        {t("thread.replyCount", { count: replyCount })}
      </Text>
    </Pressable>
  );
}

// Memoized: message object identity changes on any patch, so memo keeps
// FlashList re-renders cheap while reactions/votes/receipts update live
export const MessageBubble = memo(function MessageBubble({
  message,
  participants,
  showPollVoters,
  onLongPress,
  onToggleReaction,
  onShowReactions,
  onOpenAlbum,
  onVote,
  onViewVoters,
  onOpenThread,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation("chat");
  const userId = useAuthStore((s) => s.user?.id);
  const isMine = message.sender_id === userId;
  const isDeleted = !!message.deleted_at;
  const isPoll = message.type === "poll";
  const albumImages =
    !isDeleted && message.type === "image" ? getAttachments(message) : [];
  const mentions = isDeleted ? [] : getMentions(message);

  // Receipt ticks: one check = sent, two = seen by every other participant
  const showReceipt =
    isMine && !isDeleted && !message.id.startsWith("temp-");
  const others = showReceipt
    ? (participants ?? []).filter((p) => p.user_id !== message.sender_id)
    : [];
  const seenByAll =
    others.length > 0 && others.every((p) => hasSeen(p, message.created_at));

  if (message.type === "system") {
    return (
      <View className="my-1 items-center px-4">
        <Text className="font-sans text-label text-fg-tertiary">{message.content}</Text>
      </View>
    );
  }

  return (
    <Pressable
      className={`my-0.5 max-w-[80%] px-3 ${isMine ? "self-end" : "self-start"}`}
      onLongPress={isDeleted ? undefined : () => onLongPress?.(message)}
      delayLongPress={300}
    >
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          isMine
            ? "rounded-br-md bg-ink"
            : "rounded-bl-md bg-surface-secondary border border-border"
        }`}
      >
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
        </View>

        {!isDeleted && !message.thread_id && (
          <ThreadChip
            message={message}
            isMine={isMine}
            onPress={() => onOpenThread?.(message)}
          />
        )}
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
    </Pressable>
  );
});

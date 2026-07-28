import { useMemo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/src/stores/chatStore";
import { getPollMetadata } from "@/src/lib/messageMeta";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";
import type { MessageWithMeta } from "@/src/types";

interface PollBubbleProps {
  message: MessageWithMeta;
  isMine: boolean;
  currentUserId?: string;
  /** Voters list is only offered in group rooms. */
  showViewVotes?: boolean;
  onVote: (message: MessageWithMeta, optionIndex: number) => void;
  onViewVoters?: (message: MessageWithMeta) => void;
}

// Poll rendering inside the message bubble: monochrome fill bars,
// tap a row = optimistic vote / unvote (single choice)
export function PollBubble({
  message,
  isMine,
  currentUserId,
  showViewVotes,
  onVote,
  onViewVoters,
}: PollBubbleProps) {
  const { t } = useTranslation("chat");
  const poll = getPollMetadata(message);
  const votes = message.poll_votes ?? [];

  if (!poll) return null;

  const totalVotes = votes.length;
  const myVote = currentUserId
    ? votes.find((v) => v.user_id === currentUserId)
    : undefined;

  const questionClass = isMine ? "text-ink-inverse" : "text-fg";
  const captionClass = isMine ? "text-ink-inverse/60" : "text-fg-tertiary";

  return (
    <View style={{ width: 220 }}>
      <Text className={`mb-2 font-sans-semibold text-body leading-5 ${questionClass}`}>
        {poll.question}
      </Text>

      {poll.options.map((option, index) => {
        const count = votes.filter((v) => v.option_index === index).length;
        const ratio = totalVotes > 0 ? count / totalVotes : 0;
        const isMyChoice = myVote?.option_index === index;

        return (
          <Pressable
            key={index}
            className="mb-1.5 overflow-hidden rounded-lg"
            onPress={() => onVote(message, index)}
            accessibilityRole="button"
            accessibilityState={{ selected: isMyChoice }}
          >
            <View
              className={`rounded-lg border px-2.5 py-2 ${
                isMine
                  ? isMyChoice
                    ? "border-ink-inverse/60 bg-ink-inverse/10"
                    : "border-ink-inverse/20"
                  : isMyChoice
                    ? "border-ink bg-ink/5"
                    : "border-border"
              }`}
            >
              {/* Result fill bar behind the label */}
              <View
                className={`absolute bottom-0 left-0 top-0 ${
                  isMine ? "bg-ink-inverse/15" : "bg-ink/10"
                }`}
                style={{ width: `${ratio * 100}%` }}
              />
              <View className="flex-row items-center gap-1.5">
                {isMyChoice && (
                  <Icon
                    name={{
                      ios: "checkmark.circle.fill",
                      android: "check_circle",
                      web: "check_circle",
                    }}
                    tone={isMine ? "inverse" : "ink"}
                    size={14}
                  />
                )}
                <Text
                  className={`flex-1 font-sans text-caption ${questionClass}`}
                  numberOfLines={2}
                >
                  {option}
                </Text>
                {totalVotes > 0 && (
                  <Text className={`font-sans-medium text-label ${captionClass}`}>
                    {Math.round(ratio * 100)}%
                  </Text>
                )}
              </View>
            </View>
          </Pressable>
        );
      })}

      <View className="mt-0.5 flex-row items-center justify-between">
        <Text className={`font-sans text-label ${captionClass}`}>
          {t("poll.votes", { count: totalVotes })}
        </Text>
        {showViewVotes && (
          <Pressable
            onPress={() => onViewVoters?.(message)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Text className={`font-sans-medium text-label ${captionClass}`}>
              {t("poll.viewVotes")}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface PollVotersSheetProps {
  message: MessageWithMeta | null;
  visible: boolean;
  onClose: () => void;
}

// Voters grouped by option (names resolved from cached participants)
export function PollVotersSheet({
  message,
  visible,
  onClose,
}: PollVotersSheetProps) {
  const { t } = useTranslation("chat");
  const participants = useChatStore((s) =>
    message ? s.participantsByRoom[message.room_id] : undefined
  );

  const poll = message ? getPollMetadata(message) : null;
  const votes = message?.poll_votes ?? [];

  const votersByOption = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const v of votes) {
      const list = map.get(v.option_index) ?? [];
      list.push(v.user_id);
      map.set(v.option_index, list);
    }
    return map;
  }, [votes]);

  const profileOf = (userId: string) =>
    participants?.find((p) => p.user_id === userId)?.profiles ?? null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("poll.votersTitle")}
        </Text>
      </View>

      {votes.length === 0 ? (
        <View className="items-center px-4 py-8">
          <Text className="font-sans text-caption text-fg-tertiary">
            {t("poll.noVotes")}
          </Text>
        </View>
      ) : (
        <ScrollView className="max-h-96">
          {poll?.options.map((option, index) => {
            const voters = votersByOption.get(index) ?? [];
            if (voters.length === 0) return null;
            return (
              <View key={index} className="px-4 pt-3">
                <Text className="mb-1 font-sans text-caption text-fg-tertiary">
                  {option} · {voters.length}
                </Text>
                {voters.map((userId) => {
                  const profile = profileOf(userId);
                  const name =
                    profile?.display_name || profile?.username || "?";
                  return (
                    <View
                      key={`${index}-${userId}`}
                      className="flex-row items-center gap-3 py-2"
                    >
                      <Avatar uri={profile?.avatar_url} name={name} size={36} />
                      <Text className="flex-1 font-sans text-body text-fg">
                        {name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
          <View className="h-3" />
        </ScrollView>
      )}
    </Sheet>
  );
}

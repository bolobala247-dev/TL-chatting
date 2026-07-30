import { useMemo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/src/stores/chatStore";
import { Avatar } from "@/src/components/ui/Avatar";
import { Emoji } from "@/src/components/ui/Emoji";
import { Sheet } from "@/src/components/ui/Sheet";
import type { MessageWithMeta } from "@/src/types";

type ReactionEntry = { user_id: string; emoji: string };

interface ReactionGroup {
  emoji: string;
  userIds: string[];
}

function groupReactions(reactions: ReactionEntry[]): ReactionGroup[] {
  const map = new Map<string, ReactionGroup>();
  for (const r of reactions) {
    const group = map.get(r.emoji) ?? { emoji: r.emoji, userIds: [] };
    group.userIds.push(r.user_id);
    map.set(r.emoji, group);
  }
  return [...map.values()];
}

interface ReactionBarProps {
  reactions: ReactionEntry[];
  isMine: boolean;
  currentUserId?: string;
  onToggle: (emoji: string) => void;
  onOpenDetails: () => void;
}

// Pill chips under the bubble; tap = toggle own reaction, long-press = details
export function ReactionBar({
  reactions,
  isMine,
  currentUserId,
  onToggle,
  onOpenDetails,
}: ReactionBarProps) {
  const groups = useMemo(() => groupReactions(reactions), [reactions]);

  if (groups.length === 0) return null;

  return (
    <View
      className={`mt-1 flex-row flex-wrap gap-1 ${isMine ? "justify-end" : ""}`}
    >
      {groups.map((group) => {
        const reacted =
          !!currentUserId && group.userIds.includes(currentUserId);
        return (
          <Pressable
            key={group.emoji}
            className={`flex-row items-center gap-1 rounded-full border px-2 py-0.5 ${
              reacted
                ? "border-ink bg-ink"
                : "border-border bg-surface-secondary"
            }`}
            onPress={() => onToggle(group.emoji)}
            onLongPress={onOpenDetails}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel={group.emoji}
          >
            <Emoji emoji={group.emoji} size={13} />
            <Text
              className={`font-sans-medium text-label ${
                reacted ? "text-ink-inverse" : "text-fg-secondary"
              }`}
            >
              {group.userIds.length}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ReactionsSheetProps {
  message: MessageWithMeta | null;
  visible: boolean;
  onClose: () => void;
}

// Details: reactors grouped by emoji (names resolved from cached participants)
export function ReactionsSheet({
  message,
  visible,
  onClose,
}: ReactionsSheetProps) {
  const { t } = useTranslation("chat");
  const participants = useChatStore((s) =>
    message ? s.participantsByRoom[message.room_id] : undefined
  );

  const groups = useMemo(
    () => groupReactions(message?.message_reactions ?? []),
    [message?.message_reactions]
  );

  const profileOf = (userId: string) =>
    participants?.find((p) => p.user_id === userId)?.profiles ?? null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("reactions.title")}
        </Text>
      </View>

      <ScrollView className="max-h-96">
        {groups.map((group) => (
          <View key={group.emoji} className="px-4 pt-3">
            <View className="mb-1 flex-row items-center gap-1.5">
              <Emoji emoji={group.emoji} size={14} />
              <Text className="font-sans text-caption text-fg-tertiary">
                {group.userIds.length}
              </Text>
            </View>
            {group.userIds.map((userId) => {
              const profile = profileOf(userId);
              const name =
                profile?.display_name || profile?.username || "?";
              return (
                <View
                  key={`${group.emoji}-${userId}`}
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
        ))}
        <View className="h-3" />
      </ScrollView>
    </Sheet>
  );
}

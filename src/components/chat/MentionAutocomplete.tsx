import { useMemo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { Avatar } from "@/src/components/ui/Avatar";
import type {
  MessageMention,
  RoomParticipantWithProfile,
} from "@/src/types";

interface MentionAutocompleteProps {
  participants: RoomParticipantWithProfile[];
  /** Username fragment after the trailing "@" ("" lists everyone). */
  query: string;
  /** Own user id — you can't mention yourself. */
  excludeUserId?: string;
  onSelect: (mention: MessageMention) => void;
}

const MAX_SUGGESTIONS = 5;

// Suggestion strip shown above the composer while typing "@..." —
// parent owns positioning, this only renders the surface.
export function MentionAutocomplete({
  participants,
  query,
  excludeUserId,
  onSelect,
}: MentionAutocompleteProps) {
  const suggestions = useMemo(() => {
    const q = query.toLowerCase();
    return participants
      .filter((p) => {
        if (!p.profiles || p.user_id === excludeUserId) return false;
        if (!q) return true;
        return (
          p.profiles.username.toLowerCase().includes(q) ||
          (p.profiles.display_name ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [participants, query, excludeUserId]);

  if (suggestions.length === 0) return null;

  return (
    <View className="mx-3 mb-1 overflow-hidden rounded-2xl border border-divider bg-surface shadow-sm">
      <ScrollView keyboardShouldPersistTaps="handled">
        {suggestions.map((p) => {
          const profile = p.profiles!;
          return (
            <Pressable
              key={p.user_id}
              className="flex-row items-center gap-2.5 px-3 py-2 active:bg-pressed"
              onPress={() =>
                onSelect({
                  id: profile.id,
                  username: profile.username,
                  display_name: profile.display_name ?? profile.username,
                })
              }
              accessibilityRole="button"
            >
              <Avatar
                uri={profile.avatar_url}
                name={profile.display_name || profile.username}
                size={32}
              />
              <View className="flex-1">
                <Text
                  className="font-sans-medium text-caption text-fg"
                  numberOfLines={1}
                >
                  {profile.display_name || profile.username}
                </Text>
                <Text
                  className="font-sans text-label text-fg-tertiary"
                  numberOfLines={1}
                >
                  @{profile.username}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

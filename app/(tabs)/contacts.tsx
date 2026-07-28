import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/src/stores/authStore";
import { profileService } from "@/src/services/profileService";
import { roomService } from "@/src/services/roomService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { SearchField } from "@/src/components/ui/SearchField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { ProfileSearchResult } from "@/src/types";

export default function ContactsScreen() {
  const { t } = useTranslation("chat");
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [chatError, setChatError] = useState("");

  const handleSearch = useCallback(
    async (text: string) => {
      setQuery(text);
      if (chatError) setChatError("");
      if (!text.trim() || !user) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const data = await profileService.searchUsers(text.trim(), user.id);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [user]
  );

  const handleStartChat = useCallback(
    async (profile: ProfileSearchResult) => {
      if (!user) return;
      setChatError("");
      try {
        const room = await roomService.createDirectRoom(user.id, profile.id);
        router.push(`/chat/${room.id}` as any);
      } catch (err: unknown) {
        console.error("[Contacts] start chat", err);
        const msg =
          err instanceof Error
            ? err.message
            : t("startChatFailed");
        setChatError(msg);
      }
    },
    [user, router, t]
  );

  const renderItem = useCallback(
    ({ item }: { item: ProfileSearchResult }) => (
      <Pressable
        className="flex-row items-center gap-3 px-4 py-3 active:bg-pressed"
        onPress={() => handleStartChat(item)}
        accessibilityRole="button"
      >
        <Avatar
          uri={item.avatar_url}
          name={item.display_name || item.username}
          size={48}
        />
        <View className="flex-1">
          <Text className="font-sans-medium text-body text-fg">
            {item.display_name || item.username}
          </Text>
          <Text className="font-sans text-caption text-fg-tertiary">@{item.username}</Text>
        </View>
        <Icon
          name={{
            ios: "bubble.left",
            android: "chat_bubble",
            web: "chat_bubble",
          }}
          tone="tertiary"
          size="md"
        />
      </Pressable>
    ),
    [handleStartChat]
  );

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-divider px-4 py-3">
        <SearchField
          placeholder={t("search.placeholder")}
          value={query}
          onChangeText={handleSearch}
          autoCapitalize="none"
        />

        {chatError ? (
          <FormMessage className="mt-2">{chatError}</FormMessage>
        ) : null}
      </View>

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        // Single tap opens a chat even while the keyboard is up
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <View className="items-center pt-20">
            <Icon
              name={{ ios: "person.2", android: "group", web: "group" }}
              tone="tertiary"
              size="empty"
            />
            <Text className="mt-4 font-sans text-caption text-fg-tertiary">
              {query
                ? searching
                  ? t("search.searching")
                  : t("search.noResults")
                : t("search.prompt")}
            </Text>
          </View>
        }
      />
    </View>
  );
}

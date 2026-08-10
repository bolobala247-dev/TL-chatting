import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
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
import { EmptyState } from "@/src/components/ui/EmptyState";
import { useTabBarSpace } from "@/src/components/ui/TabBar";
import { useThemeColors } from "@/src/theme";
import type { ProfileSearchResult } from "@/src/types";

export default function ContactsScreen() {
  const { t } = useTranslation("chat");
  const router = useRouter();
  const colors = useThemeColors();
  const tabBarSpace = useTabBarSpace();
  const user = useAuthStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
        const data = await profileService.searchUsers(text.trim(), user.id, true);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [user]
  );

  // Pull-to-refresh re-runs the current search without the field spinner
  const handleRefresh = useCallback(async () => {
    if (!query.trim() || !user) return;
    setRefreshing(true);
    try {
      const data = await profileService.searchUsers(query.trim(), user.id, true);
      setResults(data);
    } catch {
      // keep the previous results on a failed refresh
    } finally {
      setRefreshing(false);
    }
  }, [query, user]);

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
        className={`mx-3 flex-row items-center gap-3 rounded-2xl px-3 py-3 ${item.id === user?.id ? "bg-surface-secondary" : "active:bg-pressed"}`}
        onPress={() => handleStartChat(item)}
        accessibilityRole="button"
        disabled={item.id === user?.id}
        accessibilityLabel={
          item.id === user?.id
            ? `${item.display_name || item.username}, ${t("search.you")}`
            : item.display_name || item.username
        }
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
          <Text className="mt-0.5 font-sans text-caption text-fg-tertiary">@{item.username}</Text>
          {item.id === user?.id ? (
            <Text className="mt-0.5 font-sans-medium text-caption text-fg-secondary">
              {t("search.you")}
            </Text>
          ) : null}
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
    [handleStartChat, t, user?.id]
  );

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pb-3 pt-1">
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.fgTertiary}
          />
        }
        // Bottom padding keeps rows clear of the floating tab bar
        contentContainerStyle={
          results.length === 0
            ? { flexGrow: 1, paddingBottom: tabBarSpace }
            : { paddingBottom: tabBarSpace }
        }
        ListEmptyComponent={
          <EmptyState
            icon={{ ios: "person.2", android: "group", web: "group" }}
            title={
              query
                ? searching
                  ? t("search.searching")
                  : t("search.noResults")
                : t("search.prompt")
            }
          />
        }
      />
    </View>
  );
}

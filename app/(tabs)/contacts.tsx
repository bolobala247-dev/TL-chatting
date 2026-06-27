import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useAuthStore } from "@/src/stores/authStore";
import { profileService } from "@/src/services/profileService";
import { roomService } from "@/src/services/roomService";
import { Avatar } from "@/src/components/ui/Avatar";
import type { Profile } from "@/src/types";

export default function ContactsScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
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
    async (profile: Profile) => {
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
            : "Không thể bắt đầu trò chuyện, vui lòng thử lại";
        setChatError(msg);
      }
    },
    [user, router]
  );

  const renderItem = useCallback(
    ({ item }: { item: Profile }) => (
      <Pressable
        className="flex-row items-center gap-3 px-4 py-3 active:bg-gray-50"
        onPress={() => handleStartChat(item)}
      >
        <Avatar
          uri={item.avatar_url}
          name={item.display_name || item.username}
          size={48}
        />
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-gray-900">
            {item.display_name || item.username}
          </Text>
          <Text className="text-sm text-gray-500">@{item.username}</Text>
        </View>
        <SymbolView
          name={{
            ios: "bubble.left",
            android: "chat_bubble",
            web: "chat_bubble",
          }}
          tintColor="#9CA3AF"
          size={20}
        />
      </Pressable>
    ),
    [handleStartChat]
  );

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-gray-100 px-4 py-3">
        <View className="flex-row items-center rounded-xl bg-gray-100 px-3">
          <SymbolView
            name={{ ios: "magnifyingglass", android: "search", web: "search" }}
            tintColor="#9CA3AF"
            size={18}
          />
          <TextInput
            className="ml-2 h-10 flex-1 text-[15px] text-gray-900"
            placeholder="Tìm kiếm người dùng..."
            placeholderTextColor="#9CA3AF"
            value={query}
            onChangeText={handleSearch}
            autoCapitalize="none"
          />
        </View>

        {chatError ? (
          <Text className="mt-2 text-sm text-red-600">{chatError}</Text>
        ) : null}
      </View>

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View className="items-center pt-20">
            <SymbolView
              name={{ ios: "person.2", android: "group", web: "group" }}
              tintColor="#D1D5DB"
              size={48}
            />
            <Text className="mt-4 text-sm text-gray-400">
              {query
                ? searching
                  ? "Đang tìm kiếm..."
                  : "Không tìm thấy người dùng"
                : "Nhập tên hoặc username để tìm kiếm"}
            </Text>
          </View>
        }
      />
    </View>
  );
}

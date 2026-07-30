import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { searchService } from "@/src/services/searchService";
import { profileService } from "@/src/services/profileService";
import { roomService } from "@/src/services/roomService";
import { useAuthStore } from "@/src/stores/authStore";
import { SEARCH_DEBOUNCE_MS, SEARCH_PAGE_SIZE } from "@/src/lib/constants";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { SearchField } from "@/src/components/ui/SearchField";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type {
  MessageSearchKind,
  MessageSearchResult,
  ProfileSearchResult,
} from "@/src/types";

type SearchTab = "all" | "message" | "user" | "image" | "file" | "link";

// "all" merges the user + message lanes; the rest map 1:1 to RPC kinds
type SearchRow =
  | { key: string; kind: "header"; title: string }
  | { key: string; kind: "user"; user: ProfileSearchResult }
  | { key: string; kind: "message"; result: MessageSearchResult };

function formatWhen(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}

export default function GlobalSearchScreen() {
  const { t, i18n } = useTranslation("chat");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);

  const [tab, setTab] = useState<SearchTab>("all");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<MessageSearchResult[]>([]);
  const [users, setUsers] = useState<ProfileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  // Guards against out-of-order responses while typing
  const requestIdRef = useRef(0);

  const cellSize = Math.floor((width - 4) / 3);
  const trimmed = query.trim();
  // Media lanes browse recent items with an empty query; text lanes wait
  const isMediaTab = tab === "image" || tab === "file" || tab === "link";
  const canSearch = isMediaTab || trimmed.length > 0;

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!canSearch || !user) {
      setMessages([]);
      setUsers([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const kind: MessageSearchKind = isMediaTab
          ? (tab as MessageSearchKind)
          : "message";
        const wantMessages = tab !== "user";
        const wantUsers = tab === "all" || tab === "user";

        const [messageRows, userRows] = await Promise.all([
          wantMessages
            ? searchService.searchMessages(trimmed, kind)
            : Promise.resolve([]),
          wantUsers
            ? profileService.searchUsers(trimmed, user.id)
            : Promise.resolve([]),
        ]);

        if (requestId !== requestIdRef.current) return;
        setMessages(messageRows);
        setUsers(userRows);
        setHasMore(wantMessages && messageRows.length >= SEARCH_PAGE_SIZE);
        setError("");
      } catch (err: unknown) {
        if (requestId !== requestIdRef.current) return;
        console.error("[GlobalSearchScreen] search", err);
        setError(t("globalSearch.failed"));
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, tab, user?.id]);

  const handleLoadMore = useCallback(async () => {
    if (loading || !hasMore || messages.length === 0 || tab === "user") return;

    const requestId = requestIdRef.current;
    const kind: MessageSearchKind = isMediaTab
      ? (tab as MessageSearchKind)
      : "message";
    const oldest = messages[messages.length - 1];

    try {
      const rows = await searchService.searchMessages(trimmed, kind, {
        before: oldest.created_at,
      });
      if (requestId !== requestIdRef.current) return;
      setMessages((prev) => [...prev, ...rows]);
      setHasMore(rows.length >= SEARCH_PAGE_SIZE);
    } catch (err: unknown) {
      console.error("[GlobalSearchScreen] load more", err);
    }
  }, [loading, hasMore, messages, tab, isMediaTab, trimmed]);

  const openRoom = useCallback(
    (roomId: string, focus?: string, at?: string) => {
      // Phase 9 §8: a message hit deep-links to that message (?focus=&at=); a
      // plain room tap omits them and opens at the bottom as before.
      router.push(
        (focus && at
          ? `/chat/${roomId}?focus=${focus}&at=${encodeURIComponent(at)}`
          : `/chat/${roomId}`) as any
      );
    },
    [router]
  );

  const handleStartChat = useCallback(
    async (profile: ProfileSearchResult) => {
      if (!user) return;
      try {
        const room = await roomService.createDirectRoom(user.id, profile.id);
        router.push(`/chat/${room.id}` as any);
      } catch (err: unknown) {
        console.error("[GlobalSearchScreen] start chat", err);
        setError(t("startChatFailed"));
      }
    },
    [user, router, t]
  );

  // Flat rows for the list: "all" shows both sections with headers
  const rows: SearchRow[] = [];
  if (tab === "all" || tab === "user") {
    if (users.length > 0 && tab === "all") {
      rows.push({
        key: "header-users",
        kind: "header",
        title: t("globalSearch.sectionUsers"),
      });
    }
    for (const u of users) {
      rows.push({ key: `user-${u.id}`, kind: "user", user: u });
    }
  }
  if (tab !== "user" && tab !== "image") {
    if (messages.length > 0 && tab === "all") {
      rows.push({
        key: "header-messages",
        kind: "header",
        title: t("globalSearch.sectionMessages"),
      });
    }
    for (const m of messages) {
      rows.push({ key: `msg-${m.id}`, kind: "message", result: m });
    }
  }

  const renderRow = useCallback(
    ({ item }: { item: SearchRow }) => {
      if (item.kind === "header") {
        return (
          <Text className="px-4 pb-1 pt-4 font-sans-semibold text-caption uppercase text-fg-tertiary">
            {item.title}
          </Text>
        );
      }

      if (item.kind === "user") {
        const u = item.user;
        return (
          <Pressable
            className="flex-row items-center gap-3 px-4 py-3 active:bg-pressed"
            onPress={() => handleStartChat(u)}
            accessibilityRole="button"
          >
            <Avatar
              uri={u.avatar_url}
              name={u.display_name || u.username}
              size={44}
            />
            <View className="flex-1">
              <Text className="font-sans-medium text-body text-fg">
                {u.display_name || u.username}
              </Text>
              <Text className="font-sans text-caption text-fg-tertiary">
                @{u.username}
              </Text>
            </View>
          </Pressable>
        );
      }

      const m = item.result;
      const preview =
        m.content ||
        (m.type === "image"
          ? t("message.imagePlaceholder")
          : t("message.filePlaceholder"));

      return (
        <Pressable
          className="flex-row items-center gap-3 border-b border-divider px-4 py-3 active:bg-pressed"
          onPress={() => openRoom(m.room_id, m.id, m.created_at)}
          accessibilityRole="button"
        >
          <Avatar uri={m.sender_avatar} name={m.sender_name ?? "?"} size={44} />
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="flex-1 font-sans-medium text-body text-fg"
                numberOfLines={1}
              >
                {m.room_name || m.sender_name || ""}
              </Text>
              {m.created_at ? (
                <Text className="font-sans text-label text-fg-tertiary">
                  {formatWhen(m.created_at, i18n.language)}
                </Text>
              ) : null}
            </View>
            <Text
              className="mt-0.5 font-sans text-caption text-fg-secondary"
              numberOfLines={2}
            >
              {preview}
            </Text>
          </View>
        </Pressable>
      );
    },
    [handleStartChat, openRoom, t, i18n.language]
  );

  const renderImageCell = useCallback(
    ({ item }: { item: MessageSearchResult }) => (
      <Pressable
        className="p-px active:opacity-70"
        onPress={() => openRoom(item.room_id, item.id, item.created_at)}
        accessibilityRole="imagebutton"
      >
        <View
          className="items-center justify-center overflow-hidden bg-surface-secondary"
          style={{ width: cellSize, height: cellSize }}
        >
          {item.media_url ? (
            <Image
              source={{ uri: item.media_url }}
              style={{ width: cellSize, height: cellSize }}
              contentFit="cover"
              transition={150}
              recyclingKey={item.id}
              cachePolicy="memory-disk"
            />
          ) : (
            <Icon
              name={{ ios: "photo", android: "image", web: "image" }}
              tone="tertiary"
              size="lg"
            />
          )}
        </View>
      </Pressable>
    ),
    [cellSize, openRoom]
  );

  const tabButtons: { key: SearchTab; label: string }[] = [
    { key: "all", label: t("globalSearch.tabs.all") },
    { key: "message", label: t("globalSearch.tabs.messages") },
    { key: "user", label: t("globalSearch.tabs.users") },
    { key: "image", label: t("globalSearch.tabs.images") },
    { key: "file", label: t("globalSearch.tabs.files") },
    { key: "link", label: t("globalSearch.tabs.links") },
  ];

  const isEmpty =
    tab === "image" ? messages.length === 0 : rows.length === 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 border-b border-divider bg-surface px-4 pb-3 pt-2">
        <Pressable
          onPress={() => router.back()}
          className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("header.back")}
        >
          <Icon
            name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
            tone="primary"
            size={22}
          />
        </Pressable>
        <SearchField
          containerClassName="flex-1"
          placeholder={t("globalSearch.placeholder")}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoFocus
        />
      </View>

      <View className="flex-row flex-wrap gap-2 bg-surface px-4 py-2.5">
        {tabButtons.map((item) => (
          <Pressable
            key={item.key}
            className={`rounded-full px-4 py-1.5 ${
              tab === item.key
                ? "bg-ink"
                : "bg-surface-secondary active:bg-pressed"
            }`}
            onPress={() => setTab(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === item.key }}
          >
            <Text
              className={`font-sans-medium text-caption ${
                tab === item.key ? "text-ink-inverse" : "text-fg-secondary"
              }`}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <View className="px-4 py-2">
          <FormMessage>{error}</FormMessage>
        </View>
      ) : null}

      {loading && isEmpty ? (
        <Spinner fullScreen />
      ) : isEmpty ? (
        <View className="items-center pt-20">
          <Icon
            name={{ ios: "magnifyingglass", android: "search", web: "search" }}
            tone="tertiary"
            size="empty"
          />
          <Text className="mt-4 px-8 text-center font-sans text-caption text-fg-tertiary">
            {canSearch ? t("globalSearch.noResults") : t("globalSearch.prompt")}
          </Text>
        </View>
      ) : tab === "image" ? (
        <FlashList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderImageCell}
          numColumns={3}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderRow}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}
    </View>
  );
}

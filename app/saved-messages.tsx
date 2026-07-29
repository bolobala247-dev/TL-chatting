import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useTranslation } from "react-i18next";
import { savedMessageService } from "@/src/services/savedMessageService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { useThemeColors } from "@/src/theme";
import { MESSAGES_PER_PAGE } from "@/src/lib/constants";
import type { SavedMessageItem } from "@/src/types";

export default function SavedMessagesScreen() {
  const { t, i18n } = useTranslation(["chat", "common"]);
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<SavedMessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");

  const fetchSaved = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError("");
      try {
        const rows = await savedMessageService.getSavedMessages(cursor);
        setItems((prev) => (cursor ? [...prev, ...rows] : rows));
        setHasMore(rows.length >= MESSAGES_PER_PAGE);
      } catch (err: unknown) {
        console.error("[SavedMessagesScreen] fetch", err);
        setError(t("saved.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore || items.length === 0) return;
    fetchSaved(items[items.length - 1].created_at ?? undefined);
  }, [loading, hasMore, items, fetchSaved]);

  // Pull-to-refresh reloads the first page
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchSaved();
    } finally {
      setRefreshing(false);
    }
  }, [fetchSaved]);

  const handleUnsave = useCallback(
    async (item: SavedMessageItem) => {
      try {
        await savedMessageService.unsave(item.message.id);
        setItems((prev) => prev.filter((s) => s.id !== item.id));
      } catch (err: unknown) {
        console.error("[SavedMessagesScreen] unsave", err);
        setError(t("saved.loadFailed"));
      }
    },
    [t]
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedMessageItem }) => {
      const { message } = item;
      const senderName =
        message.sender?.display_name ||
        message.sender?.username ||
        t("common:user");
      const preview = message.deleted_at
        ? t("message.deleted")
        : message.content ||
          (message.type === "image"
            ? t("message.imagePlaceholder")
            : message.type === "video"
              ? t("message.videoPlaceholder")
              : t("message.filePlaceholder"));
      const savedAt = item.created_at
        ? new Date(item.created_at).toLocaleDateString(i18n.language, {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "";

      return (
        <Pressable
          className="flex-row items-center gap-3 border-b border-divider px-4 py-3 active:bg-pressed"
          onPress={() => router.push(`/chat/${message.room_id}`)}
          accessibilityRole="button"
        >
          <Avatar
            uri={message.sender?.avatar_url}
            name={senderName}
            size={40}
          />
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text
                className="flex-1 font-sans-semibold text-body text-fg"
                numberOfLines={1}
              >
                {senderName}
              </Text>
              <Text className="font-sans text-label text-fg-tertiary">
                {savedAt}
              </Text>
            </View>
            <Text
              className={`mt-0.5 font-sans text-caption ${
                message.deleted_at ? "italic text-fg-tertiary" : "text-fg-secondary"
              }`}
              numberOfLines={2}
            >
              {preview}
            </Text>
          </View>
          <Pressable
            className="h-9 w-9 items-center justify-center rounded-full active:bg-pressed"
            onPress={() => handleUnsave(item)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("saved.unsave")}
          >
            <Icon
              name={{
                ios: "bookmark.slash",
                android: "bookmark_remove",
                web: "bookmark_remove",
              }}
              tone="secondary"
              size="md"
            />
          </Pressable>
        </Pressable>
      );
    },
    [router, handleUnsave, t, i18n.language]
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-divider bg-surface px-4 pb-3 pt-2">
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
        <Text
          className="flex-1 font-sans-semibold text-body text-fg"
          numberOfLines={1}
        >
          {t("saved.title")}
        </Text>
      </View>

      {error ? (
        <View className="px-4 py-2">
          <FormMessage>{error}</FormMessage>
        </View>
      ) : null}

      {loading && items.length === 0 ? (
        <Spinner fullScreen />
      ) : items.length === 0 ? (
        <EmptyState
          icon={{ ios: "bookmark", android: "bookmark", web: "bookmark" }}
          title={t("saved.empty")}
          subtitle={t("saved.emptyHint")}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.fgTertiary}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}
    </View>
  );
}

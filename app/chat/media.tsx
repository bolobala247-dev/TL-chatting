import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable, Linking, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { messageService } from "@/src/services/messageService";
import { Icon } from "@/src/components/ui/Icon";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { MEDIA_PER_PAGE } from "@/src/lib/constants";
import type { Message, MediaKind } from "@/src/types";

const URL_REGEX = /https?:\/\/[^\s]+/;

interface TabState {
  items: Message[];
  loaded: boolean;
  hasMore: boolean;
}

const INITIAL_TAB_STATE: TabState = { items: [], loaded: false, hasMore: true };

export default function SharedMediaScreen() {
  const { t } = useTranslation("chat");
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<MediaKind>("media");
  const [tabs, setTabs] = useState<Record<MediaKind, TabState>>({
    media: INITIAL_TAB_STATE,
    file: INITIAL_TAB_STATE,
    link: INITIAL_TAB_STATE,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const current = tabs[activeTab];
  const cellSize = Math.floor((width - 4) / 3);

  const fetchTab = useCallback(
    async (kind: MediaKind, cursor?: string) => {
      if (!roomId) return;
      setLoading(true);
      setError("");
      try {
        const rows = await messageService.getMediaMessages(
          roomId,
          kind,
          cursor
        );
        setTabs((prev) => ({
          ...prev,
          [kind]: {
            items: cursor ? [...prev[kind].items, ...rows] : rows,
            loaded: true,
            hasMore: rows.length >= MEDIA_PER_PAGE,
          },
        }));
      } catch (err: unknown) {
        console.error("[SharedMediaScreen] fetch", err);
        setError(t("media.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [roomId, t]
  );

  useEffect(() => {
    if (!tabs[activeTab].loaded) {
      fetchTab(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, roomId]);

  const handleLoadMore = useCallback(() => {
    if (loading || !current.hasMore || current.items.length === 0) return;
    const oldest = current.items[current.items.length - 1];
    fetchTab(activeTab, oldest.created_at ?? undefined);
  }, [loading, current, activeTab, fetchTab]);

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch((err) =>
      console.error("[SharedMediaScreen] openURL", err)
    );
  }, []);

  const renderMediaCell = useCallback(
    ({ item }: { item: Message }) => (
      <Pressable
        className="p-px active:opacity-70"
        onPress={() => item.media_url && openUrl(item.media_url)}
        accessibilityRole="imagebutton"
      >
        <View
          className="items-center justify-center overflow-hidden bg-surface-secondary"
          style={{ width: cellSize, height: cellSize }}
        >
          {item.type === "image" && item.media_url ? (
            <Image
              source={{ uri: item.media_url }}
              style={{ width: cellSize, height: cellSize }}
              contentFit="cover"
              transition={150}
            />
          ) : (
            <Icon
              name={{
                ios: "play.circle.fill",
                android: "play_circle",
                web: "play_circle",
              }}
              tone="tertiary"
              size="lg"
            />
          )}
        </View>
      </Pressable>
    ),
    [cellSize, openUrl]
  );

  const renderRow = useCallback(
    ({ item }: { item: Message }) => {
      const isLink = activeTab === "link";
      const url = isLink
        ? (item.content?.match(URL_REGEX)?.[0] ?? "")
        : (item.media_url ?? "");

      return (
        <Pressable
          className="flex-row items-center gap-3 border-b border-divider px-4 py-3 active:bg-pressed"
          onPress={() => url && openUrl(url)}
          accessibilityRole="button"
        >
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-surface-secondary">
            <Icon
              name={
                isLink
                  ? { ios: "link", android: "link", web: "link" }
                  : { ios: "doc.fill", android: "description", web: "description" }
              }
              tone="secondary"
              size="md"
            />
          </View>
          <View className="flex-1">
            <Text className="font-sans text-body text-fg" numberOfLines={1}>
              {isLink ? url : t("message.filePlaceholder")}
            </Text>
            {isLink && item.content !== url ? (
              <Text
                className="mt-0.5 font-sans text-label text-fg-tertiary"
                numberOfLines={1}
              >
                {item.content}
              </Text>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [activeTab, openUrl, t]
  );

  const emptyCopy = {
    media: t("media.emptyMedia"),
    file: t("media.emptyFiles"),
    link: t("media.emptyLinks"),
  }[activeTab];

  const tabButtons: { key: MediaKind; label: string }[] = [
    { key: "media", label: t("media.tabs.media") },
    { key: "file", label: t("media.tabs.files") },
    { key: "link", label: t("media.tabs.links") },
  ];

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
        <Text className="flex-1 font-sans-semibold text-body text-fg" numberOfLines={1}>
          {t("media.title")}
        </Text>
      </View>

      <View className="flex-row gap-2 bg-surface px-4 py-2.5">
        {tabButtons.map((tab) => (
          <Pressable
            key={tab.key}
            className={`rounded-full px-4 py-1.5 ${
              activeTab === tab.key
                ? "bg-ink"
                : "bg-surface-secondary active:bg-pressed"
            }`}
            onPress={() => setActiveTab(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text
              className={`font-sans-medium text-caption ${
                activeTab === tab.key ? "text-ink-inverse" : "text-fg-secondary"
              }`}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <View className="px-4 py-2">
          <FormMessage>{error}</FormMessage>
        </View>
      ) : null}

      {loading && !current.loaded ? (
        <Spinner fullScreen />
      ) : current.items.length === 0 ? (
        <EmptyState
          icon={
            activeTab === "media"
              ? { ios: "photo.on.rectangle", android: "photo_library", web: "photo_library" }
              : activeTab === "file"
                ? { ios: "doc", android: "description", web: "description" }
                : { ios: "link", android: "link", web: "link" }
          }
          title={emptyCopy}
        />
      ) : activeTab === "media" ? (
        <FlashList
          data={current.items}
          keyExtractor={(item) => item.id}
          renderItem={renderMediaCell}
          numColumns={3}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      ) : (
        <FlashList
          data={current.items}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}
    </View>
  );
}

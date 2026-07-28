import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/src/stores/authStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { BlockedProfile } from "@/src/types";

export default function BlockedUsersScreen() {
  const { t } = useTranslation(["settings", "chat"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore((s) => s.user?.id);
  const blocked = usePrivacyStore((s) => s.blocked);
  const blockedLoading = usePrivacyStore((s) => s.blockedLoading);
  const fetchBlocked = usePrivacyStore((s) => s.fetchBlocked);
  const unblockUser = usePrivacyStore((s) => s.unblockUser);

  const [error, setError] = useState("");

  useEffect(() => {
    void fetchBlocked();
  }, [fetchBlocked]);

  const handleUnblock = async (item: BlockedProfile) => {
    if (!userId) return;
    setError("");
    try {
      await unblockUser(userId, item.id);
    } catch (err) {
      console.error("[BlockedUsers] unblock", err);
      setError(t("privacy.blocked.unblockFailed"));
    }
  };

  const renderItem = ({ item }: { item: BlockedProfile }) => (
    <View className="flex-row items-center gap-3 border-b border-divider px-4 py-3">
      <Avatar
        uri={item.avatar_url}
        name={item.display_name || item.username}
        size={40}
      />
      <View className="flex-1">
        <Text
          className="font-sans-semibold text-body text-fg"
          numberOfLines={1}
        >
          {item.display_name || item.username}
        </Text>
        <Text className="mt-0.5 font-sans text-caption text-fg-tertiary">
          @{item.username}
        </Text>
      </View>
      <Pressable
        className="rounded-full border border-border px-3 py-1.5 active:bg-pressed"
        onPress={() => handleUnblock(item)}
        accessibilityRole="button"
      >
        <Text className="font-sans-medium text-caption text-fg">
          {t("privacy.blocked.unblock")}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-divider bg-surface px-4 pb-3 pt-2">
        <Pressable
          onPress={() => router.back()}
          className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("chat:header.back")}
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
          {t("privacy.blocked.title")}
        </Text>
      </View>

      {error ? (
        <View className="px-4 py-2">
          <FormMessage>{error}</FormMessage>
        </View>
      ) : null}

      {blockedLoading && blocked.length === 0 ? (
        <Spinner fullScreen />
      ) : blocked.length === 0 ? (
        <EmptyState
          icon={{
            ios: "person.crop.circle.badge.xmark",
            android: "block",
            web: "block",
          }}
          title={t("privacy.blocked.empty")}
          subtitle={t("privacy.blocked.emptyHint")}
        />
      ) : (
        <FlashList
          data={blocked}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        />
      )}
    </View>
  );
}

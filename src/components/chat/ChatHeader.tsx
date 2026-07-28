import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";

interface ChatHeaderProps {
  name: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  participantCount?: number;
  /** Opens the shared media / files / links screen. */
  onPressMedia?: () => void;
}

export function ChatHeader({
  name,
  avatarUrl,
  isOnline,
  participantCount,
  onPressMedia,
}: ChatHeaderProps) {
  const { t } = useTranslation("chat");
  const router = useRouter();

  return (
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

      <Avatar uri={avatarUrl} name={name} size={36} />

      <View className="flex-1">
        <Text className="font-sans-semibold text-body text-fg" numberOfLines={1}>
          {name}
        </Text>
        <Text className="font-sans text-label text-fg-tertiary">
          {isOnline
            ? t("header.online")
            : participantCount
              ? t("header.members", { count: participantCount })
              : t("header.offline")}
        </Text>
      </View>

      {onPressMedia && (
        <Pressable
          onPress={onPressMedia}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("header.media")}
        >
          <Icon
            name={{
              ios: "photo.on.rectangle",
              android: "photo_library",
              web: "photo_library",
            }}
            tone="primary"
            size={20}
          />
        </Pressable>
      )}
    </View>
  );
}

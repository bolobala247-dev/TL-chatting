import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";

interface ChatHeaderProps {
  name: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  /** Peer's last activity (already privacy-gated server-side); DM only. */
  lastSeenAt?: string | null;
  participantCount?: number;
  /** Opens the shared media / files / links screen. */
  onPressMedia?: () => void;
  /** Opens the contact info sheet (DM only). */
  onPressInfo?: () => void;
  /** Starts a 1:1 voice call (DM only). */
  onStartAudioCall?: () => void;
  /** Starts a 1:1 video call (DM only). */
  onStartVideoCall?: () => void;
}

// Relative "last seen" copy; anything beyond a week falls back to offline
function formatLastSeen(
  t: TFunction<"chat">,
  lastSeenAt: string
): string | null {
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return null;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t("header.lastSeenJustNow");
  if (minutes < 60) return t("header.lastSeenMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("header.lastSeenHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days <= 7) return t("header.lastSeenDays", { count: days });
  return null;
}

export function ChatHeader({
  name,
  avatarUrl,
  isOnline,
  lastSeenAt,
  participantCount,
  onPressMedia,
  onPressInfo,
  onStartAudioCall,
  onStartVideoCall,
}: ChatHeaderProps) {
  const { t } = useTranslation("chat");
  const router = useRouter();

  const lastSeenText = lastSeenAt ? formatLastSeen(t, lastSeenAt) : null;
  const subtitle = isOnline
    ? t("header.online")
    : lastSeenText
      ? lastSeenText
      : participantCount
        ? t("header.members", { count: participantCount })
        : t("header.offline");

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

      <Pressable
        className="flex-1"
        onPress={onPressInfo}
        disabled={!onPressInfo}
        accessibilityRole={onPressInfo ? "button" : undefined}
      >
        <Text className="font-sans-semibold text-body text-fg" numberOfLines={1}>
          {name}
        </Text>
        <Text className="font-sans text-label text-fg-tertiary">
          {subtitle}
        </Text>
      </Pressable>

      {onStartAudioCall && (
        <Pressable
          onPress={onStartAudioCall}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("call.startAudio")}
        >
          <Icon
            name={{ ios: "phone", android: "call", web: "call" }}
            tone="primary"
            size={20}
          />
        </Pressable>
      )}

      {onStartVideoCall && (
        <Pressable
          onPress={onStartVideoCall}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("call.startVideo")}
        >
          <Icon
            name={{ ios: "video", android: "videocam", web: "videocam" }}
            tone="primary"
            size={20}
          />
        </Pressable>
      )}

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

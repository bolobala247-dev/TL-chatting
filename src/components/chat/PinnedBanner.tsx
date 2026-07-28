import { Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import type { Message } from "@/src/types";
import { Icon } from "@/src/components/ui/Icon";

interface PinnedBannerProps {
  pinnedMessages: Message[];
  onPress: () => void;
}

/**
 * Compact banner under the chat header showing the latest pinned message.
 * Tapping opens the full pinned list sheet.
 */
export function PinnedBanner({ pinnedMessages, onPress }: PinnedBannerProps) {
  const { t } = useTranslation("chat");

  if (pinnedMessages.length === 0) return null;

  const latest = pinnedMessages[0];
  const preview =
    latest.content ||
    (latest.type === "image"
      ? t("message.imagePlaceholder")
      : latest.type === "video"
        ? t("message.videoPlaceholder")
        : t("message.filePlaceholder"));

  return (
    <Pressable
      className="flex-row items-center gap-2.5 border-b border-divider bg-surface-secondary px-4 py-2 active:bg-pressed"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("pinned.title")}
    >
      <Icon
        name={{ ios: "pin.fill", android: "keep", web: "keep" }}
        tone="secondary"
        size="sm"
      />
      <Text
        className="flex-1 font-sans text-caption text-fg-secondary"
        numberOfLines={1}
      >
        {preview}
      </Text>
      {pinnedMessages.length > 1 && (
        <Text className="font-sans-medium text-label text-fg-tertiary">
          {pinnedMessages.length}
        </Text>
      )}
      <Icon
        name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
        tone="tertiary"
        size="sm"
      />
    </Pressable>
  );
}

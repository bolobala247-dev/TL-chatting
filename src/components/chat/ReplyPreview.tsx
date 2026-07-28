import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import type { Message } from "@/src/types";
import { Icon } from "@/src/components/ui/Icon";

interface ReplyPreviewProps {
  message: Message;
  onDismiss: () => void;
}

export function ReplyPreview({ message, onDismiss }: ReplyPreviewProps) {
  const { t } = useTranslation("chat");
  return (
    <View className="flex-row items-center gap-2 border-t border-divider bg-surface-secondary px-4 py-2">
      <View className="w-0.5 self-stretch rounded-full bg-ink" />
      <View className="flex-1">
        <Text className="font-sans-medium text-label text-fg">
          {t("message.replyingTo")}
        </Text>
        <Text className="font-sans text-caption text-fg-tertiary" numberOfLines={1}>
          {message.content || t("message.imagePlaceholder")}
        </Text>
      </View>
      <Pressable
        onPress={onDismiss}
        className="h-9 w-9 items-center justify-center rounded-full active:opacity-50"
        hitSlop={8}
        accessibilityRole="button"
      >
        <Icon
          name={{ ios: "xmark", android: "close", web: "close" }}
          tone="tertiary"
          size="sm"
        />
      </Pressable>
    </View>
  );
}

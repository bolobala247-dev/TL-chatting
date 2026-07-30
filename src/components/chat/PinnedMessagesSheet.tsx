import { View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import type { Message } from "@/src/types";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";

interface PinnedMessagesSheetProps {
  visible: boolean;
  pinnedMessages: Message[];
  onClose: () => void;
  onUnpin: (message: Message) => void;
  // Phase 11 §2: tap a pinned row to jump to it in the conversation. Optional
  // (undefined when scroll-to-message is off) ⇒ rows stay non-interactive.
  onJump?: (message: Message) => void;
}

function formatPinTime(dateStr: string | null, locale: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PinnedMessagesSheet({
  visible,
  pinnedMessages,
  onClose,
  onUnpin,
  onJump,
}: PinnedMessagesSheetProps) {
  const { t, i18n } = useTranslation("chat");

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("pinned.count", { count: pinnedMessages.length })}
        </Text>
      </View>

      <ScrollView className="max-h-96">
        {pinnedMessages.map((message) => (
          <View
            key={message.id}
            className="flex-row items-center gap-3 border-b border-divider px-4 py-3"
          >
            <Pressable
              className="flex-1"
              onPress={onJump ? () => onJump(message) : undefined}
              disabled={!onJump}
              accessibilityRole={onJump ? "button" : undefined}
            >
              <Text className="font-sans text-body text-fg" numberOfLines={2}>
                {message.content ||
                  (message.type === "image"
                    ? t("message.imagePlaceholder")
                    : message.type === "video"
                      ? t("message.videoPlaceholder")
                      : t("message.filePlaceholder"))}
              </Text>
              <Text className="mt-0.5 font-sans text-label text-fg-tertiary">
                {formatPinTime(message.created_at, i18n.language)}
              </Text>
            </Pressable>
            <Pressable
              className="h-9 w-9 items-center justify-center rounded-full active:bg-pressed"
              onPress={() => onUnpin(message)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("pinned.unpin")}
            >
              <Icon
                name={{ ios: "pin.slash", android: "keep_off", web: "keep_off" }}
                tone="secondary"
                size="md"
              />
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

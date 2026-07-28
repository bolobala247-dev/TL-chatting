import { View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import type { ScheduledMessage } from "@/src/types";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";

interface ScheduledMessagesSheetProps {
  visible: boolean;
  scheduledMessages: ScheduledMessage[];
  onClose: () => void;
  onCancel: (scheduled: ScheduledMessage) => void;
}

function formatSendAt(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ScheduledMessagesSheet({
  visible,
  scheduledMessages,
  onClose,
  onCancel,
}: ScheduledMessagesSheetProps) {
  const { t, i18n } = useTranslation("chat");

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("schedule.listTitle")}
        </Text>
      </View>

      {scheduledMessages.length === 0 ? (
        <View className="items-center px-4 py-8">
          <Text className="font-sans text-caption text-fg-tertiary">
            {t("schedule.empty")}
          </Text>
        </View>
      ) : (
        <ScrollView className="max-h-96">
          {scheduledMessages.map((scheduled) => (
            <View
              key={scheduled.id}
              className="flex-row items-center gap-3 border-b border-divider px-4 py-3"
            >
              <View className="flex-1">
                <Text className="font-sans text-body text-fg" numberOfLines={2}>
                  {scheduled.content}
                </Text>
                <Text className="mt-0.5 font-sans text-label text-fg-tertiary">
                  {t("schedule.sendAt", {
                    time: formatSendAt(scheduled.scheduled_at, i18n.language),
                  })}
                </Text>
              </View>
              <Pressable
                className="h-9 w-9 items-center justify-center rounded-full active:bg-pressed"
                onPress={() => onCancel(scheduled)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("schedule.cancel")}
              >
                <Icon
                  name={{
                    ios: "xmark.circle",
                    android: "cancel",
                    web: "cancel",
                  }}
                  tone="danger"
                  size="md"
                />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

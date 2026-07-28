import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";

interface UndoSendBarProps {
  visible: boolean;
  onUndo: () => void;
}

/**
 * Transient pill above the composer during the undo-send grace window
 * (UNDO_SEND_WINDOW_MS). Tapping recalls the just-sent message.
 */
export function UndoSendBar({ visible, onUndo }: UndoSendBarProps) {
  const { t } = useTranslation("chat");

  if (!visible) return null;

  return (
    <View className="items-center pb-2">
      <Pressable
        className="flex-row items-center gap-2 rounded-full bg-ink px-4 py-2 active:opacity-90"
        onPress={onUndo}
        accessibilityRole="button"
        accessibilityLabel={t("undo.action")}
      >
        <Text className="font-sans text-caption text-ink-inverse/70">
          {t("undo.sent")}
        </Text>
        <Icon
          name={{
            ios: "arrow.uturn.backward",
            android: "undo",
            web: "undo",
          }}
          tone="inverse"
          size="sm"
        />
        <Text className="font-sans-semibold text-caption text-ink-inverse">
          {t("undo.action")}
        </Text>
      </Pressable>
    </View>
  );
}

import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";

interface AttachmentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Launch the multi-photo picker. */
  onPickPhotos: () => void;
  /** Open the poll composer. */
  onCreatePoll: () => void;
}

interface AttachOption {
  label: string;
  icon: IconName;
  onPress: () => void;
}

// Composer "+" sheet: photos (album) or poll
export function AttachmentSheet({
  visible,
  onClose,
  onPickPhotos,
  onCreatePoll,
}: AttachmentSheetProps) {
  const { t } = useTranslation("chat");

  const options: AttachOption[] = [
    {
      label: t("attach.photos"),
      icon: { ios: "photo.on.rectangle", android: "photo_library", web: "photo_library" },
      onPress: () => {
        onClose();
        onPickPhotos();
      },
    },
    {
      label: t("attach.poll"),
      icon: { ios: "chart.bar", android: "poll", web: "poll" },
      onPress: () => {
        onClose();
        onCreatePoll();
      },
    },
  ];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("attach.title")}
        </Text>
      </View>
      {options.map((option) => (
        <Pressable
          key={option.label}
          className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
          onPress={option.onPress}
          accessibilityRole="button"
        >
          <Icon name={option.icon} tone="secondary" size="md" />
          <Text className="font-sans text-body text-fg">{option.label}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

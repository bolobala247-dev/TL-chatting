import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";
import type { RoomWithLastMessage } from "@/src/types";

interface RoomActionsSheetProps {
  room: RoomWithLastMessage | null;
  visible: boolean;
  onClose: () => void;
  /** Toggle the conversation bookmark (pin). */
  onTogglePin: (room: RoomWithLastMessage) => void;
}

/**
 * Long-press menu for a conversation row — mirrors the MessageActions
 * layout (header strip + action rows) on the shared bottom Sheet.
 */
export function RoomActionsSheet({
  room,
  visible,
  onClose,
  onTogglePin,
}: RoomActionsSheetProps) {
  const { t } = useTranslation("chat");
  if (!room) return null;

  const isBookmarked = !!room.bookmarked_at;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text
          className="font-sans-semibold text-body text-fg"
          numberOfLines={1}
        >
          {room.room_name || t("defaultRoomName")}
        </Text>
      </View>

      <Pressable
        className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
        onPress={() => {
          onTogglePin(room);
          onClose();
        }}
        accessibilityRole="button"
      >
        <Icon
          name={
            isBookmarked
              ? { ios: "pin.slash", android: "keep_off", web: "keep_off" }
              : { ios: "pin", android: "keep", web: "keep" }
          }
          tone="secondary"
          size="md"
        />
        <Text className="font-sans text-body text-fg">
          {isBookmarked
            ? t("rooms.unpinConversation")
            : t("rooms.pinConversation")}
        </Text>
      </Pressable>
    </Sheet>
  );
}

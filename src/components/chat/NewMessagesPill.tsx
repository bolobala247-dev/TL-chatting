import { memo } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { hapticSelection } from "@/src/lib/haptics";
import { useRoomStore } from "@/src/stores/roomStore";
import { elevationFloat, useThemeColors } from "@/src/theme";

interface NewMessagesPillProps {
  /** Whether the list is currently scrolled away from the bottom (§5). */
  visible: boolean;
  /** Room whose unread badge the pill mirrors. */
  roomId: string;
  /** Snap the list back to the newest message. */
  onPress: () => void;
}

// Phase 9 §5. A floating "jump to latest" affordance shown while the user is
// reading history. When unread messages have arrived it also carries a count
// badge, mirroring the room list's unread_count so the two never disagree.
function NewMessagesPillBase({ visible, roomId, onPress }: NewMessagesPillProps) {
  const { t } = useTranslation("chat");
  const colors = useThemeColors();
  const unread = useRoomStore(
    (s) => s.rooms.find((r) => r.room_id === roomId)?.unread_count ?? 0
  );

  if (!visible) return null;

  const handlePress = () => {
    hapticSelection();
    onPress();
  };

  const label =
    unread > 0
      ? t("scroll.newMessages", { count: unread })
      : t("scroll.toLatest");

  return (
    <View className="absolute bottom-3 right-3" pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={handlePress}
        hitSlop={8}
        className="flex-row items-center gap-1.5 rounded-full px-3 py-2"
        style={[
          {
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          },
          elevationFloat,
        ]}
      >
        {unread > 0 ? (
          <Text
            className="font-sans-semibold text-caption"
            style={{ color: colors.fg }}
          >
            {label}
          </Text>
        ) : null}
        <Icon name="chevron.down" size="sm" tone="secondary" />
      </Pressable>
    </View>
  );
}

export const NewMessagesPill = memo(NewMessagesPillBase);

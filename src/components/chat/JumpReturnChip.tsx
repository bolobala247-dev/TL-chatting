import { memo } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { hapticSelection } from "@/src/lib/haptics";
import { FEATURE_SCROLL_TO_MESSAGE } from "@/src/lib/constants";
import { useJumpStore } from "@/src/stores/jumpStore";
import { elevationFloat, useThemeColors } from "@/src/theme";

interface JumpReturnChipProps {
  /** Room whose jump trail this chip mirrors. */
  roomId: string;
  /** Pop the trail and return to the previous reading position. */
  onPress: () => void;
}

// Phase 11 §8. A floating "go back" affordance shown only while a jump trail
// exists for this room — tapping it undoes the last jump (returns to where the
// user was before tapping a reply/pinned/search result). Sits opposite the
// NewMessagesPill so the two never overlap. Renders nothing when the feature is
// off or the trail is empty.
function JumpReturnChipBase({ roomId, onPress }: JumpReturnChipProps) {
  const { t } = useTranslation("chat");
  const colors = useThemeColors();
  const canReturn = useJumpStore(
    (s) => (s.historyByRoom[roomId]?.length ?? 0) > 0
  );

  if (!FEATURE_SCROLL_TO_MESSAGE || !canReturn) return null;

  const handlePress = () => {
    hapticSelection();
    onPress();
  };

  return (
    <View className="absolute bottom-3 left-3" pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("scroll.return")}
        onPress={handlePress}
        hitSlop={8}
        className="h-10 w-10 items-center justify-center rounded-full"
        style={[
          {
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          },
          elevationFloat,
        ]}
      >
        <Icon
          name={{ ios: "arrow.uturn.backward", android: "undo", web: "undo" }}
          size="sm"
          tone="secondary"
        />
      </Pressable>
    </View>
  );
}

export const JumpReturnChip = memo(JumpReturnChipBase);

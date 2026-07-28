import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors, elevationOverlay } from "@/src/theme";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet as a floating card (DESIGN_SYSTEM.md §16) — matches the
 * existing MessageActions layout so migrating it is a pure re-skin.
 */
export function Sheet({ visible, onClose, children }: SheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.scrim }}
        onPress={onClose}
        accessibilityLabel="Đóng"
      >
        <View
          className="mx-3 overflow-hidden rounded-2xl border border-border bg-surface"
          // Clears the home indicator on gesture-nav devices, keeps a
          // consistent gap on devices without a bottom inset
          style={[elevationOverlay, { marginBottom: Math.max(insets.bottom, 16) + 8 }]}
        >
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

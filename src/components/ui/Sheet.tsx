import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";
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
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.scrim }}
        onPress={onClose}
        accessibilityLabel="Đóng"
      >
        <View
          className="mx-3 mb-8 overflow-hidden rounded-2xl border border-border bg-surface"
          style={elevationOverlay}
        >
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

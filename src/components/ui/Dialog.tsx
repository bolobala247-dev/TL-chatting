import type { ReactNode } from "react";
import { Modal, View, Text, Pressable } from "react-native";
import { KeyboardAvoidingView } from "@/src/lib/keyboard";
import { useThemeColors, elevationOverlay } from "@/src/theme";

interface DialogProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** Action row rendered below the content (usually `Button`s). */
  footer?: ReactNode;
}

/**
 * Base modal dialog (DESIGN_SYSTEM.md §16) — centered card on a scrim,
 * the only elevated surface besides `Sheet`.
 */
export function Dialog({ visible, onClose, title, children, footer }: DialogProps) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Keeps the card above the keyboard when it hosts a TextInput */}
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <Pressable
          className="flex-1 items-center justify-center px-8"
          style={{ backgroundColor: colors.scrim }}
          onPress={onClose}
          accessibilityLabel="Đóng hộp thoại"
        >
          <Pressable
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6"
            style={elevationOverlay}
            onPress={(e) => e.stopPropagation()}
          >
            {title ? (
              <Text className="font-sans-semibold text-title text-fg">
                {title}
              </Text>
            ) : null}
            {children ? <View className="mt-2">{children}</View> : null}
            {footer ? (
              <View className="mt-6 flex-row justify-end gap-3">{footer}</View>
            ) : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

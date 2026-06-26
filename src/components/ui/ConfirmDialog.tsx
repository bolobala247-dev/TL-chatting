import { Modal, View, Text, Pressable } from "react-native";

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = "Xác nhận",
  cancelText = "Huỷ",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        className="flex-1 items-center justify-center bg-black/50"
        onPress={onCancel}
      >
        <Pressable
          className="mx-8 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
          onPress={(e) => e.stopPropagation()}
        >
          <Text className="text-lg font-bold text-gray-900">{title}</Text>
          <Text className="mt-2 text-base leading-6 text-gray-600">
            {message}
          </Text>

          <View className="mt-6 flex-row justify-end gap-3">
            <Pressable
              className="rounded-xl bg-gray-100 px-5 py-3 active:bg-gray-200"
              onPress={onCancel}
            >
              <Text className="text-sm font-semibold text-gray-700">
                {cancelText}
              </Text>
            </Pressable>
            <Pressable
              className={`rounded-xl px-5 py-3 ${
                destructive
                  ? "bg-red-600 active:bg-red-700"
                  : "bg-primary-600 active:bg-primary-700"
              }`}
              onPress={onConfirm}
            >
              <Text className="text-sm font-semibold text-white">
                {confirmText}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

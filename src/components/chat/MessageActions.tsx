import { View, Text, Pressable, Modal } from "react-native";
import { SymbolView } from "expo-symbols";
import type { Message } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";

interface MessageActionsProps {
  message: Message | null;
  visible: boolean;
  onClose: () => void;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (message: Message) => void;
}

interface ActionItem {
  label: string;
  icon: any;
  color: string;
  onPress: () => void;
  destructive?: boolean;
}

export function MessageActions({
  message,
  visible,
  onClose,
  onReply,
  onEdit,
  onDelete,
}: MessageActionsProps) {
  const userId = useAuthStore((s) => s.user?.id);
  if (!message) return null;

  const isMine = message.sender_id === userId;

  const actions: ActionItem[] = [
    {
      label: "Trả lời",
      icon: { ios: "arrowshape.turn.up.left", android: "reply", web: "reply" },
      color: "#374151",
      onPress: () => {
        onReply(message);
        onClose();
      },
    },
  ];

  if (isMine && message.type === "text") {
    actions.push({
      label: "Chỉnh sửa",
      icon: { ios: "pencil", android: "edit", web: "edit" },
      color: "#374151",
      onPress: () => {
        onEdit(message);
        onClose();
      },
    });
  }

  if (isMine) {
    actions.push({
      label: "Xoá",
      icon: { ios: "trash", android: "delete", web: "delete" },
      color: "#DC2626",
      destructive: true,
      onPress: () => {
        onDelete(message);
        onClose();
      },
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end bg-black/40"
        onPress={onClose}
      >
        <View className="mx-3 mb-8 overflow-hidden rounded-2xl bg-white">
          {message.content && (
            <View className="border-b border-gray-100 px-4 py-3">
              <Text className="text-sm text-gray-500" numberOfLines={2}>
                {message.content}
              </Text>
            </View>
          )}

          {actions.map((action, index) => (
            <Pressable
              key={index}
              className="flex-row items-center gap-3 px-4 py-3.5 active:bg-gray-50"
              onPress={action.onPress}
            >
              <SymbolView
                name={action.icon}
                tintColor={action.color}
                size={20}
              />
              <Text
                className={`text-base ${action.destructive ? "font-medium text-red-600" : "text-gray-900"}`}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

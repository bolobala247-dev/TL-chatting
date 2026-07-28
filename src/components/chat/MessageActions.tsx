import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import type { Message } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";

interface MessageActionsProps {
  message: Message | null;
  visible: boolean;
  /** Whether the current user already bookmarked this message. */
  isSaved: boolean;
  onClose: () => void;
  onReply: (message: Message) => void;
  onPin: (message: Message, pinned: boolean) => void;
  onSave: (message: Message, save: boolean) => void;
  onEdit: (message: Message) => void;
  /** Recall — "delete for everyone" (soft delete). */
  onDelete: (message: Message) => void;
}

interface ActionItem {
  label: string;
  icon: IconName;
  onPress: () => void;
  destructive?: boolean;
}

export function MessageActions({
  message,
  visible,
  isSaved,
  onClose,
  onReply,
  onPin,
  onSave,
  onEdit,
  onDelete,
}: MessageActionsProps) {
  const { t } = useTranslation(["common", "chat"]);
  const userId = useAuthStore((s) => s.user?.id);
  if (!message) return null;

  const isMine = message.sender_id === userId;
  const isPinned = !!message.pinned_at;

  const actions: ActionItem[] = [
    {
      label: t("actions.reply"),
      icon: { ios: "arrowshape.turn.up.left", android: "reply", web: "reply" },
      onPress: () => {
        onReply(message);
        onClose();
      },
    },
    {
      label: isPinned ? t("chat:actions.unpin") : t("chat:actions.pin"),
      icon: isPinned
        ? { ios: "pin.slash", android: "keep_off", web: "keep_off" }
        : { ios: "pin", android: "keep", web: "keep" },
      onPress: () => {
        onPin(message, !isPinned);
        onClose();
      },
    },
    {
      label: isSaved ? t("chat:actions.unsave") : t("chat:actions.save"),
      icon: isSaved
        ? {
            ios: "bookmark.slash",
            android: "bookmark_remove",
            web: "bookmark_remove",
          }
        : { ios: "bookmark", android: "bookmark", web: "bookmark" },
      onPress: () => {
        onSave(message, !isSaved);
        onClose();
      },
    },
  ];

  if (isMine && message.type === "text") {
    actions.push({
      label: t("actions.edit"),
      icon: { ios: "pencil", android: "edit", web: "edit" },
      onPress: () => {
        onEdit(message);
        onClose();
      },
    });
  }

  if (isMine) {
    actions.push({
      label: t("chat:actions.recall"),
      icon: { ios: "trash", android: "delete", web: "delete" },
      destructive: true,
      onPress: () => {
        onDelete(message);
        onClose();
      },
    });
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      {message.content && (
        <View className="border-b border-divider px-4 py-3">
          <Text className="font-sans text-caption text-fg-tertiary" numberOfLines={2}>
            {message.content}
          </Text>
        </View>
      )}

      {actions.map((action, index) => (
        <Pressable
          key={index}
          className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
          onPress={action.onPress}
          accessibilityRole="button"
        >
          <Icon
            name={action.icon}
            tone={action.destructive ? "danger" : "secondary"}
            size="md"
          />
          <Text
            className={`text-body ${
              action.destructive
                ? "font-sans-medium text-danger"
                : "font-sans text-fg"
            }`}
          >
            {action.label}
          </Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

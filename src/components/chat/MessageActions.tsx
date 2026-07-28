import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import type { MessageWithMeta } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { QUICK_REACTIONS } from "@/src/lib/constants";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";

interface MessageActionsProps {
  message: MessageWithMeta | null;
  visible: boolean;
  /** Whether the current user already bookmarked this message. */
  isSaved: boolean;
  onClose: () => void;
  onReply: (message: MessageWithMeta) => void;
  onPin: (message: MessageWithMeta, pinned: boolean) => void;
  onSave: (message: MessageWithMeta, save: boolean) => void;
  onEdit: (message: MessageWithMeta) => void;
  /** Recall — "delete for everyone" (soft delete). */
  onDelete: (message: MessageWithMeta) => void;
  /** Toggle a quick reaction on the message. */
  onReact: (message: MessageWithMeta, emoji: string) => void;
  /** Open the "seen by" list for an own message. */
  onViewReceipts: (message: MessageWithMeta) => void;
  /** Report someone else's message (evidence snapshotted server-side). */
  onReport: (message: MessageWithMeta) => void;
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
  onReact,
  onViewReceipts,
  onReport,
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
      label: t("chat:receipts.viewSeen"),
      icon: { ios: "eye", android: "visibility", web: "visibility" },
      onPress: () => {
        onViewReceipts(message);
        onClose();
      },
    });
    actions.push({
      label: t("chat:actions.recall"),
      icon: { ios: "trash", android: "delete", web: "delete" },
      destructive: true,
      onPress: () => {
        onDelete(message);
        onClose();
      },
    });
  } else {
    actions.push({
      label: t("chat:report.action"),
      icon: {
        ios: "exclamationmark.bubble",
        android: "flag",
        web: "flag",
      },
      destructive: true,
      onPress: () => {
        onReport(message);
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

      {/* Quick reactions — tap toggles and closes */}
      <View className="flex-row items-center justify-between border-b border-divider px-4 py-3">
        {QUICK_REACTIONS.map((emoji) => {
          const reacted = (message.message_reactions ?? []).some(
            (r) => r.user_id === userId && r.emoji === emoji
          );
          return (
            <Pressable
              key={emoji}
              className={`h-10 w-10 items-center justify-center rounded-full ${
                reacted ? "bg-ink/10" : "active:bg-pressed"
              }`}
              onPress={() => {
                onReact(message, emoji);
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel={emoji}
            >
              <Text className="text-[22px]">{emoji}</Text>
            </Pressable>
          );
        })}
      </View>

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

import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { MessageWithMeta } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { QUICK_REACTIONS } from "@/src/lib/constants";
import { useThemeColors, elevationOverlay } from "@/src/theme";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { Emoji } from "@/src/components/ui/Emoji";
import type { MessageLayout } from "./MessageBubble";

interface MessageActionsProps {
  message: MessageWithMeta | null;
  visible: boolean;
  /** Window coordinates of the selected bubble, used to anchor the reaction bar. */
  messageLayout?: MessageLayout | null;
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

interface MoreAction {
  label: string;
  icon: IconName;
  destructive?: boolean;
}

const FUTURE_ACTIONS: MoreAction[] = [
  {
    label: "Dịch",
    icon: { ios: "character.book.closed", android: "translate", web: "translate" },
  },
  {
    label: "Tạo hình ảnh AI",
    icon: { ios: "wand.and.stars", android: "auto_awesome", web: "auto_awesome" },
  },
];

export function MessageActions({
  message,
  visible,
  messageLayout,
  isSaved: _isSaved,
  onClose,
  onReply,
  onPin,
  onSave: _onSave,
  onEdit: _onEdit,
  onDelete,
  onReact,
  onViewReceipts: _onViewReceipts,
  onReport,
}: MessageActionsProps) {
  const userId = useAuthStore((s) => s.user?.id);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!visible) setShowMore(false);
  }, [visible]);

  if (!message) return null;

  const isMine = message.sender_id === userId;
  const isPinned = !!message.pinned_at;
  const reactionBarWidth = Math.min(screenWidth - 32, 360);
  const reactionBarLeft = messageLayout
    ? Math.min(
        Math.max(16, messageLayout.x + messageLayout.width / 2 - reactionBarWidth / 2),
        Math.max(16, screenWidth - reactionBarWidth - 16)
      )
    : 16;
  const reactionBarTop = messageLayout
    ? Math.max(insets.top + 12, messageLayout.y - 68)
    : Math.max(insets.top + 80, screenHeight * 0.35);

  const handleMoreAction = (label: string) => {
    if (label === "Ghim") {
      onPin(message, !isPinned);
      onClose();
      return;
    }
    if (label === "Xóa" && isMine) {
      onDelete(message);
      onClose();
      return;
    }
    if (label === "Báo cáo" && !isMine) {
      onReport(message);
      onClose();
      return;
    }
    // These entries are placeholders for the next feature pass.
    onClose();
  };

  const moreActions: MoreAction[] = [
    ...FUTURE_ACTIONS.slice(0, 1),
    {
      label: "Xóa",
      icon: { ios: "trash", android: "delete", web: "delete" },
      destructive: true,
    },
    {
      label: "Ghim",
      icon: isPinned
        ? { ios: "pin.slash", android: "keep_off", web: "keep_off" }
        : { ios: "pin", android: "keep", web: "keep" },
    },
    {
      label: "Chuyển tiếp",
      icon: { ios: "arrowshape.turn.up.right", android: "forward", web: "forward" },
    },
    ...FUTURE_ACTIONS.slice(1),
    {
      label: "Báo cáo",
      icon: { ios: "flag", android: "flag", web: "flag" },
      destructive: true,
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => (showMore ? setShowMore(false) : onClose())}
    >
      <View className="flex-1">
        <Pressable
          className="absolute inset-0"
          style={{ backgroundColor: colors.scrim }}
          onPress={onClose}
          accessibilityLabel="Đóng menu tin nhắn"
        />

        {showMore ? (
          <Pressable
            className="absolute self-center rounded-3xl border border-border bg-surface px-7 py-6"
            style={[elevationOverlay, { top: "30%", width: "84%", maxWidth: 420 }]}
            onPress={(event) => event.stopPropagation()}
          >
            <Text className="font-sans text-headline text-fg">Khác</Text>
            <View className="mt-4">
              {moreActions.map((action) => (
                <Pressable
                  key={action.label}
                  className="flex-row items-center gap-4 py-3 active:bg-pressed"
                  onPress={() => handleMoreAction(action.label)}
                  accessibilityRole="button"
                >
                  <Icon
                    name={action.icon}
                    tone={action.destructive ? "danger" : "secondary"}
                    size="md"
                  />
                  <Text
                    className={`font-sans text-body ${
                      action.destructive ? "text-danger" : "text-fg"
                    }`}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        ) : (
          <>
            <View
              className="absolute flex-row items-center rounded-full border border-border bg-surface-secondary px-2 py-2"
              style={{
                left: reactionBarLeft,
                top: reactionBarTop,
                width: reactionBarWidth,
              }}
            >
              {QUICK_REACTIONS.map((emoji) => {
                const reacted = (message.message_reactions ?? []).some(
                  (reaction) =>
                    reaction.user_id === userId && reaction.emoji === emoji
                );
                return (
                  <Pressable
                    key={emoji}
                    className={`flex-1 items-center justify-center rounded-full py-1 ${
                      reacted ? "bg-ink/10" : "active:bg-pressed"
                    }`}
                    onPress={() => {
                      onReact(message, emoji);
                      onClose();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={emoji}
                  >
                    <Emoji emoji={emoji} size={27} />
                  </Pressable>
                );
              })}
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full bg-ink/10"
                // Placeholder for the full reaction picker.
                onPress={() => undefined}
                accessibilityRole="button"
                accessibilityLabel="Thêm cảm xúc"
              >
                <Icon
                  name={{ ios: "plus", android: "add", web: "add" }}
                  tone="secondary"
                  size="lg"
                />
              </Pressable>
            </View>

            <View
              className="absolute inset-x-0 bottom-0 flex-row border-t border-divider bg-surface"
              style={{
                paddingBottom: Math.max(insets.bottom, 12),
                paddingTop: 12,
              }}
            >
              <Pressable
                className="flex-1 items-center gap-2 py-1 active:bg-pressed"
                onPress={() => {
                  onReply(message);
                  onClose();
                }}
                accessibilityRole="button"
              >
                <Icon
                  name={{
                    ios: "arrowshape.turn.up.left.fill",
                    android: "reply",
                    web: "reply",
                  }}
                  tone="primary"
                  size="lg"
                />
                <Text className="font-sans text-body text-fg">Trả lời</Text>
              </Pressable>
              <Pressable
                className="flex-1 items-center gap-2 py-1 active:bg-pressed"
                onPress={onClose}
                accessibilityRole="button"
              >
                <Icon
                  name={{
                    ios: "arrowshape.turn.up.right.fill",
                    android: "forward",
                    web: "forward",
                  }}
                  tone="primary"
                  size="lg"
                />
                <Text className="font-sans text-body text-fg">Chuyển tiếp</Text>
              </Pressable>
              <Pressable
                className="flex-1 items-center gap-2 py-1 active:bg-pressed"
                onPress={onClose}
                accessibilityRole="button"
              >
                <Icon
                  name={{ ios: "clock.fill", android: "schedule", web: "schedule" }}
                  tone="primary"
                  size="lg"
                />
                <Text className="font-sans text-body text-fg">Đặt lời nhắc</Text>
              </Pressable>
              <Pressable
                className="flex-1 items-center gap-2 py-1 active:bg-pressed"
                onPress={() => setShowMore(true)}
                accessibilityRole="button"
              >
                <Icon
                  name={{ ios: "line.3.horizontal", android: "menu", web: "menu" }}
                  tone="primary"
                  size="lg"
                />
                <Text className="font-sans text-body text-fg">Khác</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

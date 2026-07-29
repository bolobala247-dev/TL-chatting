import { useCallback, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useTranslation } from "react-i18next";
import i18n from "@/src/i18n";
import { Avatar } from "@/src/components/ui/Avatar";
import { Badge } from "@/src/components/ui/Badge";
import { Icon } from "@/src/components/ui/Icon";
import { useDraftStore } from "@/src/stores/draftStore";
import type { RoomWithLastMessage } from "@/src/types";

interface RoomListItemProps {
  room: RoomWithLastMessage;
  onPress: (roomId: string) => void;
  /** Long-press opens the conversation actions menu. */
  onLongPress?: (room: RoomWithLastMessage) => void;
  /** Swipe-left action — toggles the conversation bookmark (pin). */
  onTogglePin?: (room: RoomWithLastMessage) => void;
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return i18n.t("time.justNow");
  if (diffMin < 60) return i18n.t("time.minutes", { count: diffMin });
  if (diffHour < 24) return i18n.t("time.hours", { count: diffHour });
  if (diffDay < 7) return i18n.t("time.days", { count: diffDay });

  return date.toLocaleDateString(i18n.language, {
    day: "2-digit",
    month: "2-digit",
  });
}

export function RoomListItem({
  room,
  onPress,
  onLongPress,
  onTogglePin,
}: RoomListItemProps) {
  const { t } = useTranslation("chat");
  const draft = useDraftStore((s) => s.drafts[room.room_id]?.text);
  const swipeRef = useRef<SwipeableMethods>(null);
  const hasUnread = room.unread_count > 0;
  const isBookmarked = !!room.bookmarked_at;

  // Swipe-left reveals a pin/unpin action matching the row's card shape
  const renderRightActions = useCallback(
    () => (
      <Pressable
        className="mr-3 w-[76px] items-center justify-center gap-1 rounded-2xl bg-ink active:opacity-80"
        onPress={() => {
          swipeRef.current?.close();
          onTogglePin?.(room);
        }}
        accessibilityRole="button"
        accessibilityLabel={
          isBookmarked ? t("rooms.unpin") : t("rooms.pin")
        }
      >
        <Icon
          name={
            isBookmarked
              ? { ios: "pin.slash.fill", android: "keep_off", web: "keep_off" }
              : { ios: "pin.fill", android: "keep", web: "keep" }
          }
          tone="inverse"
          size="sm"
        />
        <Text className="font-sans-medium text-micro text-ink-inverse">
          {isBookmarked ? t("rooms.unpin") : t("rooms.pin")}
        </Text>
      </Pressable>
    ),
    [room, onTogglePin, isBookmarked, t]
  );

  // Media/poll messages have no (or non-representative) text content:
  // fall back to a bracketed placeholder by type
  const typePlaceholder =
    room.last_message_type === "poll"
      ? t("message.pollPlaceholder")
      : room.last_message_type === "image"
        ? t("message.imagePlaceholder")
        : room.last_message_type === "video"
          ? t("message.videoPlaceholder")
          : room.last_message_type === "file"
            ? t("message.filePlaceholder")
            : null;

  const preview =
    room.last_message_type === "poll"
      ? typePlaceholder
      : room.last_message_content || typePlaceholder;

  const row = (
    <Pressable
      className="mx-3 flex-row items-center gap-3 rounded-2xl px-3 py-3 active:bg-pressed"
      onPress={() => onPress(room.room_id)}
      onLongPress={onLongPress ? () => onLongPress(room) : undefined}
      accessibilityRole="button"
    >
      <Avatar
        uri={room.room_avatar}
        name={room.room_name || t("defaultRoomName")}
        size={48}
      />

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text
            className={`flex-1 text-body text-fg ${hasUnread ? "font-sans-semibold" : "font-sans-medium"}`}
            numberOfLines={1}
          >
            {room.room_name || t("defaultRoomName")}
          </Text>
          {isBookmarked && (
            <Icon
              name={{ ios: "pin.fill", android: "keep", web: "keep" }}
              tone="tertiary"
              size={14}
            />
          )}
          <Text className="ml-2 font-sans text-label text-fg-tertiary">
            {formatRelativeTime(room.last_message_at)}
          </Text>
        </View>

        <View className="mt-1 flex-row items-center justify-between">
          {draft ? (
            <Text
              className="flex-1 font-sans text-caption italic text-fg-tertiary"
              numberOfLines={1}
            >
              {t("draft.prefix")}: {draft}
            </Text>
          ) : (
            <Text
              className={`flex-1 text-caption ${hasUnread ? "font-sans-medium text-fg-secondary" : "font-sans text-fg-tertiary"}`}
              numberOfLines={1}
            >
              {room.last_message_sender
                ? `${room.last_message_sender}: ${preview || ""}`
                : preview || t("rooms.noMessages")}
            </Text>
          )}

          {hasUnread && (
            <Badge
              label={room.unread_count > 99 ? "99+" : String(room.unread_count)}
              className="ml-2"
            />
          )}
        </View>
      </View>
    </Pressable>
  );

  // Swipe actions are a touch idiom — desktop/web keeps the plain row
  if (Platform.OS === "web" || !onTogglePin) {
    return row;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      overshootRight={false}
      rightThreshold={32}
      renderRightActions={renderRightActions}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

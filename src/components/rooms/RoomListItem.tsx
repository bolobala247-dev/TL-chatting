import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import i18n from "@/src/i18n";
import { Avatar } from "@/src/components/ui/Avatar";
import { Badge } from "@/src/components/ui/Badge";
import type { RoomWithLastMessage } from "@/src/types";

interface RoomListItemProps {
  room: RoomWithLastMessage;
  onPress: (roomId: string) => void;
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

export function RoomListItem({ room, onPress }: RoomListItemProps) {
  const { t } = useTranslation("chat");
  const hasUnread = room.unread_count > 0;

  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 py-3 active:bg-pressed"
      onPress={() => onPress(room.room_id)}
      accessibilityRole="button"
    >
      <Avatar
        uri={room.room_avatar}
        name={room.room_name || t("defaultRoomName")}
        size={52}
      />

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text
            className={`flex-1 text-body text-fg ${hasUnread ? "font-sans-semibold" : "font-sans-medium"}`}
            numberOfLines={1}
          >
            {room.room_name || t("defaultRoomName")}
          </Text>
          <Text className="ml-2 font-sans text-label text-fg-tertiary">
            {formatRelativeTime(room.last_message_at)}
          </Text>
        </View>

        <View className="mt-0.5 flex-row items-center justify-between">
          <Text
            className={`flex-1 text-caption ${hasUnread ? "font-sans-medium text-fg-secondary" : "font-sans text-fg-tertiary"}`}
            numberOfLines={1}
          >
            {room.last_message_sender
              ? `${room.last_message_sender}: ${room.last_message_content || ""}`
              : room.last_message_content || t("rooms.noMessages")}
          </Text>

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
}

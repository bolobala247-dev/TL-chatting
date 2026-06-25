import { Pressable, Text, View } from "react-native";
import { Avatar } from "@/src/components/ui/Avatar";
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

  if (diffMin < 1) return "Vừa xong";
  if (diffMin < 60) return `${diffMin} phút`;
  if (diffHour < 24) return `${diffHour} giờ`;
  if (diffDay < 7) return `${diffDay} ngày`;

  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function RoomListItem({ room, onPress }: RoomListItemProps) {
  const hasUnread = room.unread_count > 0;

  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 py-3 active:bg-gray-50"
      onPress={() => onPress(room.room_id)}
    >
      <Avatar
        uri={room.room_avatar}
        name={room.room_name || "Chat"}
        size={52}
      />

      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text
            className={`flex-1 text-[15px] ${hasUnread ? "font-bold text-gray-900" : "font-medium text-gray-800"}`}
            numberOfLines={1}
          >
            {room.room_name || "Tin nhắn"}
          </Text>
          <Text className="ml-2 text-xs text-gray-400">
            {formatRelativeTime(room.last_message_at)}
          </Text>
        </View>

        <View className="mt-0.5 flex-row items-center justify-between">
          <Text
            className={`flex-1 text-sm ${hasUnread ? "font-medium text-gray-700" : "text-gray-500"}`}
            numberOfLines={1}
          >
            {room.last_message_sender
              ? `${room.last_message_sender}: ${room.last_message_content || ""}`
              : room.last_message_content || "Chưa có tin nhắn"}
          </Text>

          {hasUnread && (
            <View className="ml-2 min-w-[20px] items-center justify-center rounded-full bg-primary-600 px-1.5 py-0.5">
              <Text className="text-[11px] font-bold text-white">
                {room.unread_count > 99 ? "99+" : room.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

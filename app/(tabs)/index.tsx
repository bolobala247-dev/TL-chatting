import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useRooms } from "@/src/hooks/useRooms";
import { RoomListItem } from "@/src/components/rooms/RoomListItem";
import { CreateRoomModal } from "@/src/components/rooms/CreateRoomModal";
import type { RoomWithLastMessage } from "@/src/types";

export default function ChatsScreen() {
  const router = useRouter();
  const { rooms, loading, refresh } = useRooms();
  const [showCreateRoom, setShowCreateRoom] = useState(false);

  const handleRoomPress = useCallback(
    (roomId: string) => {
      router.push(`/chat/${roomId}` as any);
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: RoomWithLastMessage }) => (
      <RoomListItem room={item} onPress={handleRoomPress} />
    ),
    [handleRoomPress]
  );

  const renderEmpty = useCallback(() => {
    if (loading) return null;
    return (
      <View className="flex-1 items-center justify-center px-8 pt-20">
        <SymbolView
          name={{
            ios: "bubble.left.and.bubble.right",
            android: "chat",
            web: "chat",
          }}
          tintColor="#D1D5DB"
          size={64}
        />
        <Text className="mt-4 text-center text-lg font-medium text-gray-500">
          Chưa có cuộc trò chuyện nào
        </Text>
        <Text className="mt-2 text-center text-sm text-gray-400">
          Nhấn nút + để bắt đầu trò chuyện với bạn bè
        </Text>
      </View>
    );
  }, [loading]);

  return (
    <View className="flex-1 bg-white">
      <FlatList
        data={rooms}
        renderItem={renderItem}
        keyExtractor={(item) => item.room_id}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor="#3B82F6"
          />
        }
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={rooms.length === 0 ? { flex: 1 } : undefined}
      />

      <Pressable
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-primary-600 shadow-lg active:bg-primary-700"
        onPress={() => setShowCreateRoom(true)}
        style={{
          shadowColor: "#2563EB",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}
      >
        <SymbolView
          name={{ ios: "plus", android: "add", web: "add" }}
          tintColor="#FFFFFF"
          size={24}
        />
      </Pressable>

      <CreateRoomModal
        visible={showCreateRoom}
        onClose={() => setShowCreateRoom(false)}
      />
    </View>
  );
}

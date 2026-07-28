import { useState, useCallback } from "react";
import {
  View,
  FlatList,
  Pressable,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useRooms } from "@/src/hooks/useRooms";
import { RoomListItem } from "@/src/components/rooms/RoomListItem";
import { CreateRoomModal } from "@/src/components/rooms/CreateRoomModal";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Icon } from "@/src/components/ui/Icon";
import { useThemeColors, elevationOverlay } from "@/src/theme";
import type { RoomWithLastMessage } from "@/src/types";

export default function ChatsScreen() {
  const { t } = useTranslation("chat");
  const router = useRouter();
  const colors = useThemeColors();
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
      <EmptyState
        icon={{
          ios: "bubble.left.and.bubble.right",
          android: "chat",
          web: "chat",
        }}
        title={t("rooms.emptyTitle")}
        subtitle={t("rooms.emptySubtitle")}
      />
    );
  }, [loading, t]);

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={rooms}
        renderItem={renderItem}
        keyExtractor={(item) => item.room_id}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.fgTertiary}
          />
        }
        ListEmptyComponent={renderEmpty}
        // Bottom padding keeps the FAB from covering the last room row
        contentContainerStyle={
          rooms.length === 0 ? { flex: 1 } : { paddingBottom: 96 }
        }
      />

      <Pressable
        className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-full bg-ink active:opacity-80"
        onPress={() => setShowCreateRoom(true)}
        style={elevationOverlay}
        accessibilityRole="button"
        accessibilityLabel={t("create.title")}
      >
        <Icon
          name={{ ios: "plus", android: "add", web: "add" }}
          tone="inverse"
          size="md"
        />
      </Pressable>

      <CreateRoomModal
        visible={showCreateRoom}
        onClose={() => setShowCreateRoom(false)}
      />
    </View>
  );
}

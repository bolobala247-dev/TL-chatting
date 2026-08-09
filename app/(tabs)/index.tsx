import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { FlashList } from "@shopify/flash-list";
import { useRooms } from "@/src/hooks/useRooms";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { hapticImpact, hapticSelection } from "@/src/lib/haptics";
import { RoomListItem } from "@/src/components/rooms/RoomListItem";
import { RoomActionsSheet } from "@/src/components/rooms/RoomActionsSheet";
import { CreateRoomModal } from "@/src/components/rooms/CreateRoomModal";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";
import { Icon } from "@/src/components/ui/Icon";
import { useTabBarSpace } from "@/src/components/ui/TabBar";
import { useThemeColors, elevationFloat } from "@/src/theme";
import type { RoomWithLastMessage } from "@/src/types";

export default function ChatsScreen() {
  const { t } = useTranslation(["chat", "common"]);
  const router = useRouter();
  const colors = useThemeColors();
  const tabBarSpace = useTabBarSpace();
  const user = useAuthStore((s) => s.user);
  const toggleBookmark = useRoomStore((s) => s.toggleBookmark);
  const deleteConversation = useRoomStore((s) => s.deleteConversation);
  const { rooms, loading, refresh } = useRooms();
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [actionRoom, setActionRoom] = useState<RoomWithLastMessage | null>(null);
  const [showRoomActions, setShowRoomActions] = useState(false);
  const [deleteRoom, setDeleteRoom] = useState<RoomWithLastMessage | null>(null);
  const [roomError, setRoomError] = useState("");

  const handleRoomPress = useCallback(
    (roomId: string) => {
      // Warm the in-memory cache before navigating: page 1 races the screen
      // transition, and the chat-screen mount fetch dedups against this
      // request while it's still in flight (chatStore inFlightFetches).
      void useChatStore.getState().fetchMessages(roomId);
      router.push(`/chat/${roomId}` as any);
    },
    [router]
  );

  // Long-press opens the conversation menu (pin/unpin) with haptic feedback
  const handleRoomLongPress = useCallback((room: RoomWithLastMessage) => {
    hapticImpact();
    setActionRoom(room);
    setShowRoomActions(true);
  }, []);

  // Pins/unpins the conversation (optimistic in the store)
  const handleTogglePin = useCallback(
    (room: RoomWithLastMessage) => {
      if (!user) return;
      hapticSelection();
      void toggleBookmark(room.room_id, user.id);
    },
    [user, toggleBookmark]
  );

  const handleDeleteConversation = useCallback((room: RoomWithLastMessage) => {
    setDeleteRoom(room);
    setRoomError("");
  }, []);

  const confirmDeleteConversation = useCallback(async () => {
    if (!deleteRoom) return;
    const target = deleteRoom;
    setDeleteRoom(null);
    try {
      await deleteConversation(target.room_id);
    } catch (error: unknown) {
      console.error("[ChatsScreen] delete conversation", error);
      setRoomError(error instanceof Error ? error.message : t("rooms.deleteConversationFailed"));
    }
  }, [deleteConversation, deleteRoom, t]);

  const renderItem = useCallback(
    ({ item }: { item: RoomWithLastMessage }) => (
      <RoomListItem
        room={item}
        onPress={handleRoomPress}
        onLongPress={handleRoomLongPress}
        onTogglePin={handleTogglePin}
      />
    ),
    [handleRoomPress, handleRoomLongPress, handleTogglePin, handleDeleteConversation]
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
      {/* Fake search field: tapping opens the global search screen */}
      <View className="px-4 pb-3 pt-1">
        <Pressable
          className="h-11 flex-row items-center gap-2.5 rounded-full bg-surface-secondary px-3.5 active:bg-pressed"
          onPress={() => router.push("/search" as any)}
          accessibilityRole="button"
          accessibilityLabel={t("globalSearch.placeholder")}
        >
          <Icon
            name={{ ios: "magnifyingglass", android: "search", web: "search" }}
            size="sm"
            tone="tertiary"
          />
          <Text className="font-sans text-body text-placeholder">
            {t("globalSearch.placeholder")}
          </Text>
        </Pressable>
      </View>

      {/* FlashList recycles row views (FlatList unmounts them) — cheaper
          long-list scrolling. FlashList can't stretch an empty container
          (no flexGrow support), so the empty state renders as a plain
          ScrollView that keeps the same pull-to-refresh behavior. */}
      {rooms.length === 0 ? (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refresh}
              tintColor={colors.fgTertiary}
            />
          }
          contentContainerStyle={{ flexGrow: 1, paddingBottom: tabBarSpace }}
        >
          {renderEmpty()}
        </ScrollView>
      ) : (
        <FlashList
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
          // Bottom padding keeps the floating tab bar and FAB off the last row
          contentContainerStyle={{ paddingBottom: tabBarSpace + 72 }}
        />
      )}

      <Pressable
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-full bg-ink active:opacity-80"
        onPress={() => setShowCreateRoom(true)}
        style={[{ bottom: tabBarSpace }, elevationFloat]}
        accessibilityRole="button"
        accessibilityLabel={t("create.title")}
      >
        <Icon
          name={{ ios: "plus", android: "add", web: "add" }}
          tone="inverse"
          size="md"
        />
      </Pressable>

      <RoomActionsSheet
        room={actionRoom}
        visible={showRoomActions}
        onClose={() => setShowRoomActions(false)}
        onTogglePin={handleTogglePin}
        onDelete={handleDeleteConversation}
      />

      <ConfirmDialog
        visible={!!deleteRoom}
        title={t("rooms.deleteConversationTitle")}
        message={t("rooms.deleteConversationConfirm")}
        confirmText={t("rooms.deleteConversationAction")}
        cancelText={t("common:actions.cancel")}
        destructive
        onConfirm={confirmDeleteConversation}
        onCancel={() => setDeleteRoom(null)}
      />

      {roomError ? (
        <Text className="absolute bottom-24 left-4 right-4 rounded-xl bg-danger-bg px-4 py-3 text-center font-sans text-caption text-danger">
          {roomError}
        </Text>
      ) : null}

      <CreateRoomModal
        visible={showCreateRoom}
        onClose={() => setShowCreateRoom(false)}
      />
    </View>
  );
}

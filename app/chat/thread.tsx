import { useCallback, useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import {
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView } from "@/src/lib/keyboard";
import { supabase } from "@/src/lib/supabase";
import { messageService } from "@/src/services/messageService";
import { useAuthStore } from "@/src/stores/authStore";
import { useRoomParticipants } from "@/src/hooks/useRoomParticipants";
import { MessageBubble } from "@/src/components/chat/MessageBubble";
import { MessageInput } from "@/src/components/chat/MessageInput";
import { Icon } from "@/src/components/ui/Icon";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Message, MessageWithMeta } from "@/src/types";

const RESUBSCRIBE_DELAY_MS = 3000;

export default function ThreadScreen() {
  const { t } = useTranslation("chat");
  const { roomId, rootId } = useLocalSearchParams<{
    roomId: string;
    rootId: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const { participants } = useRoomParticipants(roomId!);

  // Thread messages live locally: root first, replies oldest → newest
  const [messages, setMessages] = useState<MessageWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inputText, setInputText] = useState("");

  // Composer sits flush above the keyboard (same pattern as ChatScreen)
  const { progress } = useReanimatedKeyboardAnimation();
  const composerInsetStyle = useAnimatedStyle(
    () => ({
      paddingBottom: interpolate(progress.value, [0, 1], [insets.bottom, 0]),
    }),
    [insets.bottom]
  );

  const fetchThread = useCallback(async () => {
    if (!rootId) return;
    try {
      const rows = await messageService.getThreadMessages(rootId);
      setMessages(rows);
      setError("");
    } catch (err: unknown) {
      console.error("[ThreadScreen] fetch", err);
      setError(t("thread.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [rootId, t]);

  useEffect(() => {
    void fetchThread();
  }, [fetchThread]);

  // Own realtime subscription: room-filtered server-side, thread-filtered
  // client-side (postgres_changes supports a single filter only)
  useEffect(() => {
    if (!roomId || !rootId) return;

    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hadDrop = false;

    const inThread = (m: Message) =>
      m.id === rootId || m.thread_id === rootId;

    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (disposed) return;
        if (channel) supabase.removeChannel(channel);
        connect();
      }, RESUBSCRIBE_DELAY_MS);
    };

    const connect = () => {
      if (disposed) return;

      channel = supabase
        .channel(`thread:${rootId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const message = payload.new as Message;
            if (!inThread(message)) return;
            setMessages((prev) =>
              prev.some((m) => m.id === message.id)
                ? prev
                : [...prev, message]
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const message = payload.new as Message;
            if (!inThread(message)) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === message.id ? { ...m, ...message } : m
              )
            );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const id = (payload.old as { id: string }).id;
            setMessages((prev) => prev.filter((m) => m.id !== id));
          }
        )
        .subscribe((status) => {
          if (disposed) return;

          if (status === "SUBSCRIBED") {
            if (hadDrop) {
              hadDrop = false;
              void fetchThread();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            hadDrop = true;
            scheduleReconnect();
          }
        });
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId, rootId, fetchThread]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!user || !roomId || !rootId) return;
      if (error) setError("");
      setInputText("");

      try {
        const created = await messageService.sendMessage({
          room_id: roomId,
          sender_id: user.id,
          content,
          type: "text",
          reply_to: rootId,
          thread_id: rootId,
        });
        // Realtime may have delivered it already — dedup by id
        setMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created]
        );
      } catch (err: unknown) {
        console.error("[ThreadScreen] send", err);
        setInputText(content);
        setError(t("thread.sendFailed"));
      }
    },
    [user, roomId, rootId, error, t]
  );

  const renderItem = useCallback(
    ({ item }: { item: MessageWithMeta }) => (
      <MessageBubble message={item} participants={participants} />
    ),
    [participants]
  );

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior="padding">
      <View
        className="flex-row items-center gap-3 border-b border-divider bg-surface px-4 pb-3 pt-2"
        style={{ marginTop: insets.top }}
      >
        <Pressable
          onPress={() => router.back()}
          className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("header.back")}
        >
          <Icon
            name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
            tone="primary"
            size={22}
          />
        </Pressable>
        <Text
          className="flex-1 font-sans-semibold text-body text-fg"
          numberOfLines={1}
        >
          {t("thread.title")}
        </Text>
      </View>

      {loading ? (
        <Spinner fullScreen />
      ) : messages.length === 0 ? (
        <EmptyState
          icon={{
            ios: "bubble.left.and.bubble.right",
            android: "forum",
            web: "forum",
          }}
          title={t("thread.empty")}
        />
      ) : (
        <FlashList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      )}

      <Animated.View style={composerInsetStyle}>
        {error ? (
          <View className="border-t border-divider bg-danger-bg px-4 py-2">
            <FormMessage>{error}</FormMessage>
          </View>
        ) : null}
        <MessageInput
          value={inputText}
          onChangeText={setInputText}
          onSend={handleSend}
        />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

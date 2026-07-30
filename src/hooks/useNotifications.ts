import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { startPushTokenSync } from "@/src/services/notificationService";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { prefetchService } from "@/src/services/prefetchService";

const ANDROID_CHANNEL_ID = "messages";

// expo-notifications is not supported on web — guard every native call
const isWeb = Platform.OS === "web";

if (!isWeb) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const roomId = notification.request.content.data?.roomId as
        | string
        | undefined;
      const activeRoomId = useChatStore.getState().activeRoomId;
      const shouldShow = !(roomId && roomId === activeRoomId);

      return {
        shouldShowAlert: shouldShow,
        shouldPlaySound: shouldShow,
        shouldSetBadge: shouldShow,
        shouldShowBanner: shouldShow,
        shouldShowList: shouldShow,
      };
    },
  });
}

// Resolved once at module load, so the rules of hooks are preserved
const useLastNotificationResponse: () =>
  | Notifications.NotificationResponse
  | null
  | undefined = isWeb
  ? () => null
  : Notifications.useLastNotificationResponse;

export function useNotifications(enabled: boolean) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  // Covers cold start (app killed, launched by tapping the notification)
  // as well as warm taps — the response persists until a new one arrives
  const lastResponse = useLastNotificationResponse();
  const handledResponseRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }

    return startPushTokenSync(userId);
  }, [enabled, userId]);

  useEffect(() => {
    // Wait until auth/navigation are ready so the deep link is not
    // clobbered by AuthGate redirects on cold start
    if (!enabled || !lastResponse) return;

    const responseId = `${lastResponse.notification.request.identifier}:${lastResponse.notification.date}`;
    if (handledResponseRef.current === responseId) return;
    handledResponseRef.current = responseId;

    const roomId = lastResponse.notification.request.content.data?.roomId as
      | string
      | undefined;

    if (roomId) {
      // Highest-value predictor: warm the target room before navigation so the
      // chat screen mounts against a warm cache (no-op when the flag is off).
      prefetchService.warmRoom(roomId, { tier: "CRITICAL", scope: "notif" });
      router.push(`/chat/${roomId}`);
    }
  }, [enabled, lastResponse, router]);
}

export { ANDROID_CHANNEL_ID };

import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { startPushTokenSync } from "@/src/services/notificationService";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";

const ANDROID_CHANNEL_ID = "messages";

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

export function useNotifications(enabled: boolean) {
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);
  // Covers cold start (app killed, launched by tapping the notification)
  // as well as warm taps — the response persists until a new one arrives
  const lastResponse = Notifications.useLastNotificationResponse();
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
      router.push(`/chat/${roomId}`);
    }
  }, [enabled, lastResponse, router]);
}

export { ANDROID_CHANNEL_ID };

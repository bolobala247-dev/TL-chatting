import { useEffect } from "react";
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

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }

    return startPushTokenSync(userId);
  }, [enabled, userId]);

  useEffect(() => {
    const responseSub =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const roomId = response.notification.request.content.data?.roomId as
          | string
          | undefined;

        if (roomId) {
          router.push(`/chat/${roomId}`);
        }
      });

    return () => {
      responseSub.remove();
    };
  }, [router]);
}

export { ANDROID_CHANNEL_ID };

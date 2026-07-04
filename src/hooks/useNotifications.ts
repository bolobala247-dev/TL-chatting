import { useEffect } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { pushTokenService } from "@/src/services/pushTokenService";
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

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Tin nhắn",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.error("[useNotifications] Thiếu EAS projectId trong app config");
    return null;
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  return token;
}

export function useNotifications(enabled: boolean) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!enabled || !user || Platform.OS !== "android") {
      return;
    }

    let cancelled = false;

    async function setupPushToken() {
      try {
        const token = await registerForPushNotifications();
        if (cancelled || !token) return;

        await pushTokenService.upsertToken(
          user!.id,
          token,
          "android",
          Device.modelName ?? undefined
        );
      } catch (error) {
        console.error("[useNotifications]", error);
      }
    }

    setupPushToken();

    return () => {
      cancelled = true;
    };
  }, [enabled, user?.id]);

  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      // Foreground display is handled by setNotificationHandler.
    });

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
      receivedSub.remove();
      responseSub.remove();
    };
  }, [router]);
}

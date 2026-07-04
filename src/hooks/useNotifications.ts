import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { EAS_PROJECT_ID } from "@/src/lib/constants";
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

function resolveProjectId(): string | null {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    EAS_PROJECT_ID
  );
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn("[useNotifications] Push chỉ hoạt động trên thiết bị thật");
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
    console.warn("[useNotifications] Người dùng chưa cấp quyền thông báo");
    return null;
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    console.error("[useNotifications] Thiếu EAS projectId");
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
  const syncingRef = useRef(false);

  useEffect(() => {
    if (!enabled || !user || Platform.OS !== "android") {
      return;
    }

    let cancelled = false;

    async function syncPushToken() {
      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        const token = await registerForPushNotifications();
        if (cancelled || !token) return;

        await pushTokenService.upsertToken(
          user!.id,
          token,
          "android",
          Device.modelName ?? undefined
        );
        console.log("[useNotifications] Đã lưu push token");
      } catch (error) {
        console.error("[useNotifications]", error);
      } finally {
        syncingRef.current = false;
      }
    }

    syncPushToken();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncPushToken();
      }
    });

    return () => {
      cancelled = true;
      appStateSub.remove();
    };
  }, [enabled, user?.id]);

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

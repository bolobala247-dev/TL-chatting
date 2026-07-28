import { AppState, Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import i18n from "@/src/i18n";
import { EAS_PROJECT_ID } from "@/src/lib/constants";
import { supabase } from "@/src/lib/supabase";
import { pushTokenService } from "@/src/services/pushTokenService";

const ANDROID_CHANNEL_ID = "messages";
// Per-install identifier — Device.modelName collides between identical
// phone models and caused sibling token deletion (audit P11)
const INSTALL_ID_STORAGE_KEY = "tl-install-id";

export type PushRegistrationResult =
  | { ok: true; token: string }
  | { ok: false; reason: string };

async function getInstallId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(INSTALL_ID_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // fall through and generate a fresh id
  }

  const installId = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    await SecureStore.setItemAsync(INSTALL_ID_STORAGE_KEY, installId);
  } catch {
    // non-fatal: worst case a new id is generated next launch
  }

  return installId;
}

function resolveProjectId(): string {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    EAS_PROJECT_ID
  );
}

export async function getNotificationPermissionStatus(): Promise<
  Notifications.PermissionStatus | "unsupported"
> {
  if (Platform.OS !== "android" || !Device.isDevice) {
    return "unsupported";
  }

  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

export async function registerPushNotificationsForUser(
  userId: string
): Promise<PushRegistrationResult> {
  if (Platform.OS !== "android") {
    return { ok: false, reason: i18n.t("notifications:errors.androidOnly") };
  }

  if (!Device.isDevice) {
    return { ok: false, reason: i18n.t("notifications:errors.physicalDeviceRequired") };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user || session.user.id !== userId) {
    return { ok: false, reason: i18n.t("notifications:errors.sessionNotReady") };
  }

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: i18n.t("notifications:channelName"),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return {
      ok: false,
      reason: i18n.t("notifications:errors.permissionDenied"),
    };
  }

  let expoToken: string;

  try {
    const response = await Notifications.getExpoPushTokenAsync({
      projectId: resolveProjectId(),
    });
    expoToken = response.data;
  } catch (error) {
    console.error("[notificationService] getExpoPushTokenAsync", error);
    const message =
      error instanceof Error
        ? error.message
        : i18n.t("notifications:errors.tokenFetchFailed");

    if (message.includes("Firebase") || message.includes("FCM")) {
      return {
        ok: false,
        reason: i18n.t("notifications:errors.fcmMisconfigured"),
      };
    }

    return { ok: false, reason: message };
  }

  try {
    const installId = await getInstallId();
    await pushTokenService.upsertToken(
      userId,
      expoToken,
      "android",
      installId
    );
  } catch (error) {
    console.error("[notificationService] upsertToken", error);
    const message =
      error instanceof Error
        ? error.message
        : i18n.t("notifications:errors.tokenSaveFailed");
    return { ok: false, reason: message };
  }

  return { ok: true, token: expoToken };
}

export function startPushTokenSync(userId: string): () => void {
  let cancelled = false;

  async function sync() {
    if (cancelled) return;
    await registerPushNotificationsForUser(userId);
  }

  void sync();

  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void sync();
    }
  });

  return () => {
    cancelled = true;
    subscription.remove();
  };
}

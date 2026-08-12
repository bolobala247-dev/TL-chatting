import i18n from "@/src/i18n";
import { WEB_PUSH_VAPID_PUBLIC_KEY } from "@/src/lib/constants";
import { supabase } from "@/src/lib/supabase";

export type WebPushPermissionStatus =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

export type WebPushRegistrationResult =
  | { ok: true }
  | { ok: false; reason: string };

type SubscriptionJSON = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function toApplicationServerKey(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = window.atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function asSubscriptionJSON(subscription: PushSubscription): SubscriptionJSON {
  return subscription.toJSON() as SubscriptionJSON;
}

async function getServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

async function invokeSubscriptionAction(
  action: "subscribe" | "unsubscribe",
  subscription: SubscriptionJSON
): Promise<void> {
  const { error } = await supabase.functions.invoke(
    "manage-web-push-subscription",
    {
      body: { action, subscription },
    }
  );

  if (error) throw error;
}

async function hasCurrentSession(userId?: string): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return Boolean(session?.user && (!userId || session.user.id === userId));
}

export const webPushService = {
  getPermissionStatus(): WebPushPermissionStatus {
    if (!isSupported()) return "unsupported";
    return Notification.permission;
  },

  async registerForUser(userId: string): Promise<WebPushRegistrationResult> {
    if (!isSupported()) {
      return {
        ok: false,
        reason: i18n.t("notifications:errors.webUnsupported"),
      };
    }

    if (!WEB_PUSH_VAPID_PUBLIC_KEY) {
      return {
        ok: false,
        reason: i18n.t("notifications:errors.webPushNotConfigured"),
      };
    }

    // Request permission before any network await. Browsers can reject a
    // permission prompt if the transient user gesture has already expired.
    let permission = Notification.permission;
    try {
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
    } catch (error) {
      console.error("[webPushService] permission", error);
      return {
        ok: false,
        reason: i18n.t("notifications:errors.webPermissionDenied"),
      };
    }

    if (permission !== "granted") {
      return {
        ok: false,
        reason: i18n.t("notifications:errors.webPermissionDenied"),
      };
    }

    try {
      if (!(await hasCurrentSession(userId))) {
        return {
          ok: false,
          reason: i18n.t("notifications:errors.sessionNotReady"),
        };
      }

      const registration = await getServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toApplicationServerKey(
            WEB_PUSH_VAPID_PUBLIC_KEY
          ),
        });
      }

      await invokeSubscriptionAction("subscribe", asSubscriptionJSON(subscription));
      return { ok: true };
    } catch (error) {
      console.error("[webPushService] register", error);
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : i18n.t("notifications:errors.webSubscriptionFailed"),
      };
    }
  },

  async syncIfGranted(userId: string): Promise<void> {
    if (!isSupported() || Notification.permission !== "granted") return;
    if (!WEB_PUSH_VAPID_PUBLIC_KEY || !(await hasCurrentSession(userId))) return;

    try {
      const registration = await getServiceWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await invokeSubscriptionAction("subscribe", asSubscriptionJSON(subscription));
      }
    } catch (error) {
      // Background re-sync is best effort. Settings registration surfaces the
      // actionable error to the user when they explicitly enable notifications.
      console.error("[webPushService] sync", error);
    }
  },

  startSync(userId: string): () => void {
    let cancelled = false;

    const sync = () => {
      if (!cancelled) void this.syncIfGranted(userId);
    };

    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);

    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === "WEB_PUSH_SUBSCRIPTION_CHANGED") sync();
    };
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      navigator.serviceWorker?.removeEventListener(
        "message",
        onServiceWorkerMessage
      );
    };
  },

  async removeCurrentSubscription(): Promise<void> {
    if (!isSupported()) return;

    let subscription: PushSubscription | null = null;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      subscription = (await registration?.pushManager.getSubscription()) ?? null;
      if (!subscription) return;

      await invokeSubscriptionAction("unsubscribe", {
        endpoint: subscription.endpoint,
      });
    } catch (error) {
      console.error("[webPushService] unregister", error);
    } finally {
      try {
        await subscription?.unsubscribe();
      } catch (error) {
        console.error("[webPushService] browser unsubscribe", error);
      }
    }
  },
};

export type WebPushPermissionStatus =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

export type WebPushRegistrationResult =
  | { ok: true }
  | { ok: false; reason: string };

export const webPushService = {
  getPermissionStatus(): WebPushPermissionStatus {
    return "unsupported";
  },

  async registerForUser(_userId: string): Promise<WebPushRegistrationResult> {
    return { ok: false, reason: "Web Push is only available on the web" };
  },

  async syncIfGranted(_userId: string): Promise<void> {},

  startSync(_userId: string): () => void {
    return () => undefined;
  },

  async removeCurrentSubscription(): Promise<void> {},
};

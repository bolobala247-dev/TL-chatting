import enAuth from "@/locales/en/auth.json";
import enChat from "@/locales/en/chat.json";
import enCommon from "@/locales/en/common.json";
import enErrors from "@/locales/en/errors.json";
import enNotifications from "@/locales/en/notifications.json";
import enProfile from "@/locales/en/profile.json";
import enSettings from "@/locales/en/settings.json";
import viAuth from "@/locales/vi/auth.json";
import viChat from "@/locales/vi/chat.json";
import viCommon from "@/locales/vi/common.json";
import viErrors from "@/locales/vi/errors.json";
import viNotifications from "@/locales/vi/notifications.json";
import viProfile from "@/locales/vi/profile.json";
import viSettings from "@/locales/vi/settings.json";

export const defaultNS = "common";

export const namespaces = [
  "common",
  "auth",
  "chat",
  "profile",
  "settings",
  "notifications",
  "errors",
] as const;

// English is the reference language: its keys drive the typed t() signature
export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    chat: enChat,
    profile: enProfile,
    settings: enSettings,
    notifications: enNotifications,
    errors: enErrors,
  },
  vi: {
    common: viCommon,
    auth: viAuth,
    chat: viChat,
    profile: viProfile,
    settings: viSettings,
    notifications: viNotifications,
    errors: viErrors,
  },
} as const;

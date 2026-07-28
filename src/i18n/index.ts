import "intl-pluralrules";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultNS, namespaces, resources } from "./resources";

const LANGUAGE_STORAGE_KEY = "talo-language";

export const SUPPORTED_LANGUAGES = ["en", "vi"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// Native names on purpose — a language picker must stay readable
// no matter which language is currently active
export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

export function isSupportedLanguage(value: unknown): value is AppLanguage {
  return (
    typeof value === "string" &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Device language if supported, otherwise English (requirement for logged-out users). */
function detectDeviceLanguage(): AppLanguage {
  const deviceCode = getLocales()[0]?.languageCode;
  return isSupportedLanguage(deviceCode) ? deviceCode : "en";
}

/** Explicit language choice persisted on this device, if any. */
export async function getStoredLanguage(): Promise<AppLanguage | null> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Initializes i18next once at app startup.
 * Priority: locally persisted choice → device language → English.
 * (A profile-stored language, if any, is applied later by authStore.fetchProfile.)
 */
export async function initI18n(): Promise<typeof i18n> {
  if (i18n.isInitialized) return i18n;

  const storedLanguage = await getStoredLanguage();

  await i18n.use(initReactI18next).init({
    resources,
    lng: storedLanguage ?? detectDeviceLanguage(),
    fallbackLng: "en",
    defaultNS,
    ns: [...namespaces],
    interpolation: {
      // React Native already escapes rendered strings
      escapeValue: false,
    },
    returnNull: false,
  });

  return i18n;
}

/** Switches the UI language and persists the choice locally. */
export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persistence failure must not break the runtime switch
  }
}

export default i18n;

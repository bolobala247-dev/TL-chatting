import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { colorScheme as nativewindScheme, useColorScheme } from "nativewind";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  themeColors,
  type ResolvedScheme,
  type ThemeColors,
  type ThemePreference,
} from "./tokens";

const THEME_STORAGE_KEY = "talo.theme-preference";

interface ThemeContextValue {
  /** User choice: light, dark, or follow the system. */
  preference: ThemePreference;
  /** The scheme actually rendered after resolving "system". */
  scheme: ResolvedScheme;
  /** JS-side color tokens for props that cannot use className. */
  colors: ThemeColors;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Loads the persisted theme preference before the first frame is shown.
 * Call from the root layout and keep the splash screen visible until it
 * resolves so the app never flashes the wrong theme.
 */
export function useThemeBootstrap(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (isThemePreference(stored)) {
          nativewindScheme.set(stored);
        }
      })
      .catch(() => {
        // Storage unavailable — fall back to the system scheme
      })
      .finally(() => setReady(true));
  }, []);

  return ready;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme } = useColorScheme();
  const [preference, setPreferenceState] =
    useState<ThemePreference>("system");

  // Sync the in-memory preference with whatever bootstrap restored
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (isThemePreference(stored)) {
        setPreferenceState(stored);
      }
    });
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    nativewindScheme.set(next);
    AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => {
      // Persistence is best-effort; the session keeps the chosen theme
    });
  }, []);

  const scheme: ResolvedScheme = colorScheme === "dark" ? "dark" : "light";

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      scheme,
      colors: themeColors[scheme],
      setPreference,
    }),
    [preference, scheme, setPreference]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

/** Shorthand for the common case of only needing color tokens. */
export function useThemeColors(): ThemeColors {
  return useTheme().colors;
}

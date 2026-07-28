import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { initI18n } from "@/src/i18n";
import { ThemeProvider, useTheme, useThemeBootstrap } from "@/src/theme";
import { useAuth } from "@/src/hooks/useAuth";
import { useNotifications } from "@/src/hooks/useNotifications";
import { useRealtimeRooms } from "@/src/hooks/useRealtime";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { VercelInsights } from "@/src/components/VercelInsights";
import "../global.css";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { session, initialized } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useNotifications(!!session && initialized);
  // Mounted once at the root so unread badges update on every screen,
  // including when deep-linked directly into a chat from a notification
  useRealtimeRooms();

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === "(auth)";
    const onResetPassword = segments[1] === "reset-password";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup && !onResetPassword) {
      router.replace("/(tabs)");
    }
  }, [session, initialized, segments]);

  if (!initialized) {
    return <Spinner fullScreen />;
  }

  return <Slot />;
}

// StatusBar must follow the resolved theme, so it lives under ThemeProvider
function ThemedApp() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <AuthGate />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // i18n must be ready before the first screen renders so no raw keys flash
  const [i18nReady, setI18nReady] = useState(false);
  // Persisted theme applies before first paint so the app never flashes
  const themeReady = useThemeBootstrap();

  useEffect(() => {
    initI18n().finally(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded && i18nReady && themeReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, i18nReady, themeReady]);

  if (!fontsLoaded || !i18nReady || !themeReady) {
    return null;
  }

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
      <VercelInsights />
    </KeyboardProvider>
  );
}

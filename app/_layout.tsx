import { useEffect, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { initI18n } from "@/src/i18n";
import { useAuth } from "@/src/hooks/useAuth";
import { useNotifications } from "@/src/hooks/useNotifications";
import { useRealtimeRooms } from "@/src/hooks/useRealtime";
import { LoadingSpinner } from "@/src/components/ui/LoadingSpinner";
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
    return <LoadingSpinner fullScreen />;
  }

  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });
  // i18n must be ready before the first screen renders so no raw keys flash
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().finally(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded && i18nReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, i18nReady]);

  if (!fontsLoaded || !i18nReady) {
    return null;
  }

  return (
    <>
      <StatusBar style="auto" />
      <AuthGate />
    </>
  );
}

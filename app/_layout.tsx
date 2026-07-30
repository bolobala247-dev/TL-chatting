import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
// Per-weight subpath imports — the package root re-exports all 18 weights
// (~7MB of .ttf), which would all land in the bundle/export
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { initI18n } from "@/src/i18n";
import { databaseService } from "@/src/services/databaseService";
import { outboxService } from "@/src/services/outboxService";
import { mediaService } from "@/src/services/mediaService";
import { searchIndexer } from "@/src/services/searchIndexer";
import { prefetchService } from "@/src/services/prefetchService";
import { ThemeProvider, useTheme, useThemeBootstrap, useThemeColors } from "@/src/theme";
import { useAuth } from "@/src/hooks/useAuth";
import { useNotifications } from "@/src/hooks/useNotifications";
import { usePresenceHeartbeat } from "@/src/hooks/usePresence";
import { useRealtimeRooms } from "@/src/hooks/useRealtime";
import { AppLockGate } from "@/src/components/AppLockGate";
import { CallHost } from "@/src/components/call/CallHost";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { VercelInsights } from "@/src/components/VercelInsights";
import "../global.css";

export { ErrorBoundary } from "expo-router";

SplashScreen.preventAutoHideAsync();

function AuthGate() {
  const { session, initialized } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colors = useThemeColors();

  useNotifications(!!session && initialized);
  // Own presence heartbeat + privacy settings bootstrap (owner-only writes)
  usePresenceHeartbeat(!!session && initialized);
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

  // Restart recovery (§8.1): once the DB is migrated and a session is restored,
  // rebuild the outbox schedule and drive any due sends. No-op when the flag is
  // off or the outbox is empty; safe to re-run on session changes.
  useEffect(() => {
    if (!session || !initialized) return;
    void outboxService.resume();
    // Media plane restart recovery (Phase 7A §11.2): rebuild the upload
    // schedule from the durable queue right beside the outbox. No-op when the
    // media flag is off or the queue is empty; safe to re-run on session change.
    void mediaService.resume();
    // Search-index coverage repair + initial fill (Phase 8B §16.2/§16.3):
    // heal any drift and fill the derived index from the cache. No-op when the
    // search flag is off; bounded, chunked, and never blocks first paint.
    void searchIndexer.repair();
    // App-launch warm batch (Phase 10 §2.1): warm the recency/frequency/bookmark
    // set so the most-likely-next rooms mount against a warm cache. No-op when
    // FEATURE_INTELLIGENT_PREFETCH is off; fully cancellable, never load-bearing.
    prefetchService.poke("launch");
  }, [session, initialized]);

  if (!initialized) {
    return <Spinner fullScreen />;
  }

  // Native stack so detail screens (chat, search, settings...) get platform
  // slide transitions and edge/full-screen swipe-back on mobile
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      />
      {/* Global calling overlay — renders above every screen while a call is
          active, and runs the incoming-call listener when signed in */}
      {session && <CallHost />}
    </>
  );
}

// StatusBar must follow the resolved theme, so it lives under ThemeProvider
function ThemedApp() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {/* Lock sits above everything, including the auth flow */}
      <AppLockGate>
        <AuthGate />
      </AppLockGate>
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
    // Local SQLite cache (Phase 2 foundation): open + migrate in the
    // background. Fire-and-forget — nothing renders from it yet, startup is
    // never gated on it, and failure just disables the cache tier.
    void databaseService.init();
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
        <VercelInsights />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

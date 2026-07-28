import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appLockService } from "@/src/services/appLockService";
import { useCooldown } from "@/src/hooks/useCooldown";
import {
  APP_LOCK_COOLDOWN_SECONDS,
  APP_LOCK_MAX_ATTEMPTS,
  APP_LOCK_PIN_LENGTH,
} from "@/src/lib/constants";
import { Button } from "@/src/components/ui/Button";
import { Icon } from "@/src/components/ui/Icon";
import { TextField } from "@/src/components/ui/TextField";

interface AppLockGateProps {
  children: React.ReactNode;
}

/**
 * Local app lock (SECURITY_REVIEW.md §App Lock). Covers the whole app with
 * a PIN/biometric prompt on cold start and whenever the app returns from
 * background. Purely local: no Supabase involvement, native-only.
 */
export function AppLockGate({ children }: AppLockGateProps) {
  const { t } = useTranslation("settings");
  const insets = useSafeAreaInsets();

  // null = still reading SecureStore on cold start (render nothing yet)
  const [locked, setLocked] = useState<boolean | null>(
    appLockService.isSupported() ? null : false
  );
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);
  const attemptsRef = useRef(0);
  const bioPromptedRef = useRef(false);
  const { cooldown, setCooldown } = useCooldown();

  useEffect(() => {
    if (!appLockService.isSupported()) return;

    let disposed = false;

    const evaluate = async (initial: boolean) => {
      const enabled = await appLockService.isEnabled();
      if (disposed) return;
      if (initial) {
        setLocked(enabled);
      }
      const [bioEnabled, bioReady] = await Promise.all([
        appLockService.isBiometricsEnabled(),
        appLockService.canUseBiometrics(),
      ]);
      if (!disposed) setBioAvailable(enabled && bioEnabled && bioReady);
    };

    void evaluate(true);

    // Re-lock whenever the app leaves the foreground (and pick up settings
    // changes made while the app was running)
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        void appLockService.isEnabled().then((enabled) => {
          if (disposed || !enabled) return;
          bioPromptedRef.current = false;
          setPin("");
          setError("");
          setLocked(true);
          void evaluate(false);
        });
      }
    });

    return () => {
      disposed = true;
      sub.remove();
    };
  }, []);

  const unlock = useCallback(() => {
    attemptsRef.current = 0;
    setPin("");
    setError("");
    setLocked(false);
  }, []);

  const handleBiometric = useCallback(async () => {
    try {
      const ok = await appLockService.authenticateBiometric(
        t("privacy.appLock.lock.biometricPrompt")
      );
      if (ok) unlock();
    } catch (err) {
      console.error("[AppLockGate] biometric", err);
    }
  }, [t, unlock]);

  // Offer biometrics automatically once per lock session
  useEffect(() => {
    if (locked && bioAvailable && !bioPromptedRef.current) {
      bioPromptedRef.current = true;
      void handleBiometric();
    }
  }, [locked, bioAvailable, handleBiometric]);

  const handleUnlockWithPin = async () => {
    if (cooldown > 0) return;
    const candidate = pin.trim();
    if (candidate.length < APP_LOCK_PIN_LENGTH.min) {
      setError(t("privacy.appLock.pinTooShort"));
      return;
    }

    const ok = await appLockService.verifyPin(candidate);
    if (ok) {
      unlock();
      return;
    }

    attemptsRef.current += 1;
    setPin("");
    if (attemptsRef.current >= APP_LOCK_MAX_ATTEMPTS) {
      attemptsRef.current = 0;
      setCooldown(APP_LOCK_COOLDOWN_SECONDS);
      setError("");
    } else {
      setError(t("privacy.appLock.wrongPin"));
    }
  };

  if (locked === null) return null;

  if (!locked) return <>{children}</>;

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-1 items-center justify-center gap-3">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-secondary">
          <Icon
            name={{ ios: "lock.fill", android: "lock", web: "lock" }}
            tone="primary"
            size="lg"
          />
        </View>
        <Text className="font-sans-semibold text-title text-fg">
          {t("privacy.appLock.lock.title")}
        </Text>
        <Text className="font-sans text-caption text-fg-secondary">
          {cooldown > 0
            ? t("privacy.appLock.lock.tooManyAttempts", { count: cooldown })
            : t("privacy.appLock.lock.subtitle")}
        </Text>

        <View className="mt-4 w-full max-w-sm gap-4">
          <TextField
            value={pin}
            onChangeText={(text) => {
              setPin(text.replace(/[^0-9]/g, ""));
              if (error) setError("");
            }}
            placeholder={t("privacy.appLock.pinPlaceholder")}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={APP_LOCK_PIN_LENGTH.max}
            editable={cooldown <= 0}
            error={error || undefined}
            returnKeyType="done"
            onSubmitEditing={handleUnlockWithPin}
          />

          <Button
            title={t("privacy.appLock.lock.unlock")}
            onPress={handleUnlockWithPin}
            disabled={cooldown > 0}
            variant="primary"
          />

          {bioAvailable ? (
            <Button
              title={t("privacy.appLock.lock.useBiometrics")}
              onPress={handleBiometric}
              variant="secondary"
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

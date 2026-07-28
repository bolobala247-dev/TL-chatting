import { useEffect, useState } from "react";
import { View, Text, Pressable, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/src/lib/keyboard";
import { appLockService } from "@/src/services/appLockService";
import { APP_LOCK_PIN_LENGTH } from "@/src/lib/constants";
import { Button } from "@/src/components/ui/Button";
import { Card } from "@/src/components/ui/Card";
import { Icon } from "@/src/components/ui/Icon";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { useThemeColors } from "@/src/theme";

function isValidPin(pin: string): boolean {
  return (
    /^[0-9]+$/.test(pin) &&
    pin.length >= APP_LOCK_PIN_LENGTH.min &&
    pin.length <= APP_LOCK_PIN_LENGTH.max
  );
}

export default function AppLockScreen() {
  const { t } = useTranslation(["settings", "chat"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  const supported = appLockService.isSupported();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);

  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [disableError, setDisableError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) {
      setEnabled(false);
      return;
    }
    let disposed = false;
    void (async () => {
      const [isEnabled, canBio, bioOn] = await Promise.all([
        appLockService.isEnabled(),
        appLockService.canUseBiometrics(),
        appLockService.isBiometricsEnabled(),
      ]);
      if (disposed) return;
      setEnabled(isEnabled);
      setBioSupported(canBio);
      setBioEnabled(bioOn);
    })();
    return () => {
      disposed = true;
    };
  }, [supported]);

  const handleEnable = async () => {
    setPinError("");
    setConfirmError("");
    if (!isValidPin(pin)) {
      setPinError(t("privacy.appLock.pinTooShort"));
      return;
    }
    if (pin !== confirmPin) {
      setConfirmError(t("privacy.appLock.pinMismatch"));
      return;
    }
    setBusy(true);
    try {
      await appLockService.enable(pin);
      setEnabled(true);
      setPin("");
      setConfirmPin("");
    } catch (err) {
      console.error("[AppLock] enable", err);
      setPinError(t("privacy.appLock.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setDisableError("");
    setBusy(true);
    try {
      const ok = await appLockService.verifyPin(currentPin.trim());
      if (!ok) {
        setDisableError(t("privacy.appLock.wrongPin"));
        return;
      }
      await appLockService.disable();
      setEnabled(false);
      setBioEnabled(false);
      setCurrentPin("");
    } catch (err) {
      console.error("[AppLock] disable", err);
      setDisableError(t("privacy.appLock.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleBiometrics = async (value: boolean) => {
    setBioEnabled(value);
    try {
      await appLockService.setBiometricsEnabled(value);
    } catch (err) {
      console.error("[AppLock] biometrics", err);
      setBioEnabled(!value);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-divider bg-surface px-4 pb-3 pt-2">
        <Pressable
          onPress={() => router.back()}
          className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("chat:header.back")}
        >
          <Icon
            name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
            tone="primary"
            size={22}
          />
        </Pressable>
        <Text
          className="flex-1 font-sans-semibold text-body text-fg"
          numberOfLines={1}
        >
          {t("privacy.appLock.title")}
        </Text>
      </View>

      {enabled === null ? (
        <Spinner fullScreen />
      ) : !supported ? (
        <View className="px-4 pt-6">
          <Card className="p-4">
            <Text className="font-sans text-caption text-fg-secondary">
              {t("privacy.appLock.unsupported")}
            </Text>
          </Card>
        </View>
      ) : (
        <KeyboardAwareScrollView
          className="flex-1"
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-4 pt-6">
            <Text className="font-sans text-caption text-fg-secondary">
              {t("privacy.appLock.description")}
            </Text>
          </View>

          {!enabled ? (
            <View className="mt-6 gap-4 px-4 pb-10">
              <TextField
                label={t("privacy.appLock.pinLabel")}
                value={pin}
                onChangeText={(text) => {
                  setPin(text.replace(/[^0-9]/g, ""));
                  if (pinError) setPinError("");
                }}
                placeholder={t("privacy.appLock.pinPlaceholder")}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={APP_LOCK_PIN_LENGTH.max}
                error={pinError || undefined}
              />
              <TextField
                label={t("privacy.appLock.confirmPinLabel")}
                value={confirmPin}
                onChangeText={(text) => {
                  setConfirmPin(text.replace(/[^0-9]/g, ""));
                  if (confirmError) setConfirmError("");
                }}
                placeholder={t("privacy.appLock.pinPlaceholder")}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={APP_LOCK_PIN_LENGTH.max}
                error={confirmError || undefined}
              />
              <Button
                title={t("privacy.appLock.enable")}
                onPress={handleEnable}
                loading={busy}
                variant="primary"
              />
            </View>
          ) : (
            <View className="mt-6 gap-6 px-4 pb-10">
              <FormMessage tone="success">
                {t("privacy.appLock.enabledStatus")}
              </FormMessage>

              {bioSupported ? (
                <Card className="flex-row items-center justify-between gap-3 p-4">
                  <View className="flex-1">
                    <Text className="font-sans text-body text-fg">
                      {t("privacy.appLock.biometrics")}
                    </Text>
                    <Text className="mt-0.5 font-sans text-label text-fg-tertiary">
                      {t("privacy.appLock.biometricsHint")}
                    </Text>
                  </View>
                  <Switch
                    value={bioEnabled}
                    onValueChange={handleToggleBiometrics}
                    trackColor={{ false: colors.disabled, true: colors.ink }}
                    thumbColor={colors.surface}
                  />
                </Card>
              ) : null}

              <View className="gap-4">
                <TextField
                  label={t("privacy.appLock.currentPinLabel")}
                  value={currentPin}
                  onChangeText={(text) => {
                    setCurrentPin(text.replace(/[^0-9]/g, ""));
                    if (disableError) setDisableError("");
                  }}
                  placeholder={t("privacy.appLock.pinPlaceholder")}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={APP_LOCK_PIN_LENGTH.max}
                  error={disableError || undefined}
                />
                <Button
                  title={t("privacy.appLock.disable")}
                  onPress={handleDisable}
                  loading={busy}
                  variant="danger"
                />
              </View>
            </View>
          )}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

import { useRef, useState } from "react";
import { View, Text, Pressable, type TextInput } from "react-native";
import { Link } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import CountryFlag from "react-native-country-flag";
import { KeyboardAwareScrollView } from "@/src/lib/keyboard";
import {
  LANGUAGE_LABELS,
  isSupportedLanguage,
  setAppLanguage,
  type AppLanguage,
} from "@/src/i18n";
import { useAuthStore } from "@/src/stores/authStore";
import { useTheme } from "@/src/theme";
import { Button } from "@/src/components/ui/Button";
import { Icon } from "@/src/components/ui/Icon";
import { PasswordInput } from "@/src/components/ui/PasswordInput";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";

// ISO 3166 country codes used by react-native-country-flag
const LANGUAGE_FLAG_ISO: Record<AppLanguage, string> = {
  en: "gb",
  vi: "vn",
};

// Logo đổi theo theme: symbol đen trên nền sáng, trắng trên nền tối
const LOGO_BY_SCHEME = {
  light: require("@/design-assets/brand/png/talo-symbol-black.png"),
  dark: require("@/design-assets/brand/png/talo-symbol-white.png"),
} as const;

export default function LoginScreen() {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const { signIn, loading } = useAuthStore();
  const { scheme, setPreference } = useTheme();
  const isDark = scheme === "dark";

  const currentLanguage: AppLanguage = isSupportedLanguage(i18n.language)
    ? i18n.language
    : "en";
  const nextLanguage: AppLanguage = currentLanguage === "en" ? "vi" : "en";

  const handleLogin = async () => {
    setError("");
    if (!identifier.trim() || !password.trim()) {
      setError(t("validation.missingCredentials"));
      return;
    }

    try {
      await signIn(identifier.trim(), password);
    } catch (err: unknown) {
      console.error("[Login]", err);
      // Supabase trả về lỗi tiếng Anh — map sang thông báo tiếng Việt
      const code = (err as { code?: string } | null)?.code;
      if (
        code === "invalid_credentials" ||
        (err instanceof Error && err.message === "Invalid login credentials")
      ) {
        setError(t("errors.invalidCredentials"));
        return;
      }
      const msg =
        err instanceof Error ? err.message : t("errors.loginFailed");
      setError(msg);
    }
  };

  return (
    <View className="flex-1 bg-background">
      {/* Theme + language toggles — reachable before signing in */}
      <View
        className="absolute right-6 z-10 flex-row items-center gap-2"
        style={{ top: insets.top + 12 }}
      >
        <Pressable
          className="h-9 w-9 items-center justify-center rounded-full bg-surface-secondary active:bg-pressed"
          onPress={() => setPreference(isDark ? "light" : "dark")}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t(
            isDark ? "common:theme.switchToLight" : "common:theme.switchToDark"
          )}
        >
          <Icon
            name={
              isDark
                ? { ios: "sun.max", android: "light_mode", web: "light_mode" }
                : { ios: "moon", android: "dark_mode", web: "dark_mode" }
            }
            tone="secondary"
            size="sm"
          />
        </Pressable>

        <Pressable
          className="flex-row items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-2 active:bg-pressed"
          onPress={() => void setAppLanguage(nextLanguage)}
          hitSlop={6}
          accessibilityRole="button"
        >
          <CountryFlag
            isoCode={LANGUAGE_FLAG_ISO[currentLanguage]}
            size={14}
            style={{ borderRadius: 3 }}
          />
          <Text className="font-sans-semibold text-label text-fg-secondary">
            {LANGUAGE_LABELS[currentLanguage]}
          </Text>
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-center px-6"
        contentContainerStyle={{
          paddingTop: insets.top + 56,
          paddingBottom: insets.bottom + 24,
        }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-10 items-center">
          <Image
            source={LOGO_BY_SCHEME[scheme]}
            style={{ width: 72, height: 72 }}
            contentFit="contain"
            accessibilityLabel={t("common:appName")}
          />
          <Text className="mt-4 font-sans-bold text-display text-ink">
            {t("common:appName")}
          </Text>
          <Text className="mt-2 font-sans text-body text-fg-tertiary">
            {t("tagline")}
          </Text>
        </View>

        <View className="gap-4">
          <TextField
            label={t("fields.identifier.label")}
            error={!!error}
            placeholder={t("fields.identifier.placeholder")}
            value={identifier}
            onChangeText={(text) => {
              setIdentifier(text);
              if (error) setError("");
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="username"
            autoComplete="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <PasswordInput
            ref={passwordRef}
            label={t("fields.password.label")}
            error={!!error}
            placeholder={t("fields.password.placeholder")}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error) setError("");
            }}
            textContentType="password"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />

          <View className="items-end">
            <Link href="/(auth)/forgot-password" asChild>
              <Text className="py-1 font-sans-medium text-caption text-ink">
                {t("login.forgotPassword")}
              </Text>
            </Link>
          </View>

          {error ? <FormMessage>{error}</FormMessage> : null}

          <Button
            title={t("login.submit")}
            onPress={handleLogin}
            loading={loading}
          />

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="font-sans text-caption text-fg-tertiary">
              {t("login.noAccount")}
            </Text>
            <Link href="/(auth)/register" asChild>
              <Text className="font-sans-semibold text-caption text-ink">
                {t("login.signUpNow")}
              </Text>
            </Link>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

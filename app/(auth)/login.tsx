import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import CountryFlag from "react-native-country-flag";
import {
  LANGUAGE_LABELS,
  isSupportedLanguage,
  setAppLanguage,
  type AppLanguage,
} from "@/src/i18n";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";
import { PasswordInput } from "@/src/components/ui/PasswordInput";

// ISO 3166 country codes used by react-native-country-flag
const LANGUAGE_FLAG_ISO: Record<AppLanguage, string> = {
  en: "gb",
  vi: "vn",
};

export default function LoginScreen() {
  const { t, i18n } = useTranslation(["auth", "common"]);
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { signIn, loading } = useAuthStore();

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
      const msg =
        err instanceof Error ? err.message : t("errors.loginFailed");
      setError(msg);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Language toggle — reachable before signing in */}
      <Pressable
        className="absolute right-6 z-10 flex-row items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 active:bg-gray-200"
        style={{ top: insets.top + 12 }}
        onPress={() => void setAppLanguage(nextLanguage)}
      >
        <CountryFlag
          isoCode={LANGUAGE_FLAG_ISO[currentLanguage]}
          size={14}
          style={{ borderRadius: 3 }}
        />
        <Text className="text-xs font-semibold text-gray-700">
          {LANGUAGE_LABELS[currentLanguage]}
        </Text>
      </Pressable>

      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10 items-center">
          <Text className="text-4xl font-bold text-black">
            {t("common:appName")}
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            {t("tagline")}
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              {t("fields.identifier.label")}
            </Text>
            <TextInput
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                error ? "border-red-500" : "border-gray-300"
              }`}
              placeholder={t("fields.identifier.placeholder")}
              placeholderTextColor="#9CA3AF"
              value={identifier}
              onChangeText={(text) => {
                setIdentifier(text);
                if (error) setError("");
              }}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
            />
          </View>

          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              {t("fields.password.label")}
            </Text>
            <PasswordInput
              error={!!error}
              placeholder={t("fields.password.placeholder")}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError("");
              }}
              textContentType="password"
              autoComplete="password"
            />
          </View>

          <View className="items-end">
            <Link href="/(auth)/forgot-password" asChild>
              <Text className="text-sm font-medium text-primary-600">
                {t("login.forgotPassword")}
              </Text>
            </Link>
          </View>

          {error ? (
            <Text className="text-sm text-red-600">{error}</Text>
          ) : null}

          <Button
            title={t("login.submit")}
            onPress={handleLogin}
            loading={loading}
          />

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-500">
              {t("login.noAccount")}
            </Text>
            <Link href="/(auth)/register" asChild>
              <Text className="text-sm font-semibold text-primary-600">
                {t("login.signUpNow")}
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

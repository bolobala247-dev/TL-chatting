import { useState } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCooldown } from "@/src/hooks/useCooldown";
import { formatAuthFormError, logAuthErrorDebug } from "@/src/lib/authErrors";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { StatusScreen } from "@/src/components/ui/StatusScreen";

export default function ForgotPasswordScreen() {
  const { t } = useTranslation(["auth", "common", "errors"]);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const { resetPassword, loading } = useAuthStore();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const { cooldown, setCooldown } = useCooldown();

  const handleReset = async () => {
    setError("");
    if (!email.trim()) {
      setError(t("validation.enterEmail"));
      return;
    }

    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err: unknown) {
      logAuthErrorDebug("ForgotPassword", err);
      const { message, cooldownSeconds } = formatAuthFormError(
        err,
        t("errors:generic"),
        "password_reset",
      );
      setError(message);
      if (cooldownSeconds) setCooldown(cooldownSeconds);
    }
  };

  if (sent) {
    return (
      <StatusScreen
        icon={{ ios: "envelope", android: "mail", web: "mail" }}
        tone="info"
        title={t("forgot.sentTitle")}
        message={
          <>
            {t("forgot.sentBody")}{"\n"}
            <Text className="font-sans-medium text-fg">{email}</Text>
          </>
        }
      >
        <Button
          title={t("forgot.backToLogin")}
          onPress={() => router.replace("/(auth)/login")}
        />
      </StatusScreen>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10">
          <Text className="font-sans-bold text-headline text-fg">
            {t("forgot.title")}
          </Text>
          <Text className="mt-2 font-sans text-body text-fg-tertiary">
            {t("forgot.subtitle")}
          </Text>
        </View>

        <View className="gap-4">
          <TextField
            label={t("fields.email.label")}
            placeholder={t("fields.email.placeholder")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoFocus
          />

          {error ? <FormMessage>{error}</FormMessage> : null}

          <Button
            title={
              cooldown > 0
                ? t("forgot.submitCooldown", { count: cooldown })
                : t("forgot.submit")
            }
            onPress={handleReset}
            loading={loading}
            disabled={cooldown > 0}
          />

          <View className="mt-4 items-center">
            <Link href="/(auth)/login" asChild>
              <Text className="font-sans-semibold text-caption text-ink">
                {t("forgot.backToLogin")}
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

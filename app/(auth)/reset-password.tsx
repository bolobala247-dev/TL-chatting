import { useEffect, useState } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import i18n from "@/src/i18n";
import { useAuthStore } from "@/src/stores/authStore";
import { supabase } from "@/src/lib/supabase";
import { Button } from "@/src/components/ui/Button";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { PasswordInput } from "@/src/components/ui/PasswordInput";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { StatusScreen } from "@/src/components/ui/StatusScreen";

function getResetPasswordErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return i18n.t("errors:generic");
  }

  if (
    error.name === "AuthSessionMissingError" ||
    error.message.toLowerCase().includes("auth session missing")
  ) {
    return i18n.t("auth:errors.invalidResetLink");
  }

  return error.message;
}

export default function ResetPasswordScreen() {
  const { t } = useTranslation(["auth", "common"]);
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const { updatePassword, loading, initialized, setSession } = useAuthStore();

  useEffect(() => {
    if (!initialized) return;

    let cancelled = false;

    const verifyRecoverySession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (cancelled) return;

        if (session) {
          setSession(session);
          setHasRecoverySession(true);
        } else {
          setFormError(t("errors.invalidResetLink"));
        }
      } catch (error: unknown) {
        console.error("[ResetPassword] verify session", error);
        if (!cancelled) {
          setFormError(getResetPasswordErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    };

    verifyRecoverySession();

    return () => {
      cancelled = true;
    };
  }, [initialized, setSession]);

  const handleUpdate = async () => {
    setPasswordError("");
    setConfirmPasswordError("");
    setFormError("");

    if (!hasRecoverySession) {
      setFormError(t("errors.invalidResetLink"));
      return;
    }

    if (!password.trim()) {
      setPasswordError(t("validation.enterNewPassword"));
      return;
    }
    if (password.length < 6) {
      setPasswordError(t("validation.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setConfirmPasswordError(t("validation.passwordMismatch"));
      return;
    }

    try {
      await updatePassword(password);
      setSuccess(true);
    } catch (error: unknown) {
      console.error("[ResetPassword]", error);
      setFormError(getResetPasswordErrorMessage(error));
    }
  };

  if (checkingSession) {
    return <Spinner fullScreen />;
  }

  if (success) {
    return (
      <StatusScreen
        icon={{
          ios: "checkmark.circle",
          android: "check_circle",
          web: "check_circle",
        }}
        title={t("reset.successTitle")}
        message={t("reset.successBody")}
      >
        <Button
          title={t("reset.signIn")}
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
            {t("reset.title")}
          </Text>
          <Text className="mt-2 font-sans text-body text-fg-tertiary">
            {t("reset.subtitle")}
          </Text>
        </View>

        <View className="gap-4">
          <PasswordInput
            label={t("fields.newPassword.label")}
            error={passwordError}
            placeholder={t("fields.newPassword.placeholder")}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (passwordError) setPasswordError("");
            }}
            editable={hasRecoverySession}
            textContentType="newPassword"
            autoComplete="new-password"
          />

          <PasswordInput
            label={t("fields.confirmPassword.label")}
            error={confirmPasswordError}
            placeholder={t("fields.confirmNewPassword.placeholder")}
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (confirmPasswordError) setConfirmPasswordError("");
            }}
            editable={hasRecoverySession}
            textContentType="newPassword"
            autoComplete="new-password"
          />

          {formError ? <FormMessage>{formError}</FormMessage> : null}

          {hasRecoverySession ? (
            <Button
              title={t("reset.submit")}
              onPress={handleUpdate}
              loading={loading}
            />
          ) : (
            <Link href="/(auth)/forgot-password" asChild>
              <Text className="text-center font-sans-semibold text-caption text-ink">
                {t("reset.requestNewLink")}
              </Text>
            </Link>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

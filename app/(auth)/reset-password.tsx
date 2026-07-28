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
import { LoadingSpinner } from "@/src/components/ui/LoadingSpinner";
import { PasswordInput } from "@/src/components/ui/PasswordInput";

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
    return <LoadingSpinner fullScreen />;
  }

  if (success) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-5xl">✅</Text>
        <Text className="mt-6 text-center text-xl font-bold text-gray-900">
          {t("reset.successTitle")}
        </Text>
        <Text className="mt-3 text-center text-base text-gray-500">
          {t("reset.successBody")}
        </Text>
        <View className="mt-8 w-full">
          <Button
            title={t("reset.signIn")}
            onPress={() => router.replace("/(auth)/login")}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10">
          <Text className="text-2xl font-bold text-gray-900">
            {t("reset.title")}
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            {t("reset.subtitle")}
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              {t("fields.newPassword.label")}
            </Text>
            <PasswordInput
              error={!!passwordError}
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
            {passwordError ? (
              <Text className="mt-1.5 text-sm text-red-600">{passwordError}</Text>
            ) : null}
          </View>

          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              {t("fields.confirmPassword.label")}
            </Text>
            <PasswordInput
              error={!!confirmPasswordError}
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
            {confirmPasswordError ? (
              <Text className="mt-1.5 text-sm text-red-600">
                {confirmPasswordError}
              </Text>
            ) : null}
          </View>

          {formError ? (
            <Text className="text-sm text-red-600">{formError}</Text>
          ) : null}

          {hasRecoverySession ? (
            <Button
              title={t("reset.submit")}
              onPress={handleUpdate}
              loading={loading}
            />
          ) : (
            <Link href="/(auth)/forgot-password" asChild>
              <Text className="text-center text-sm font-semibold text-primary-600">
                {t("reset.requestNewLink")}
              </Text>
            </Link>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

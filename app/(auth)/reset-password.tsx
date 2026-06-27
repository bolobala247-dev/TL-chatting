import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuthStore } from "@/src/stores/authStore";
import { supabase } from "@/src/lib/supabase";
import { Button } from "@/src/components/ui/Button";
import { LoadingSpinner } from "@/src/components/ui/LoadingSpinner";

function getResetPasswordErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Đã xảy ra lỗi, vui lòng thử lại";
  }

  if (
    error.name === "AuthSessionMissingError" ||
    error.message.toLowerCase().includes("auth session missing")
  ) {
    return "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu link mới.";
  }

  return error.message;
}

export default function ResetPasswordScreen() {
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
          setFormError(
            "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu link mới."
          );
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
      setFormError(
        "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng yêu cầu link mới."
      );
      return;
    }

    if (!password.trim()) {
      setPasswordError("Vui lòng nhập mật khẩu mới");
      return;
    }
    if (password.length < 6) {
      setPasswordError("Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmPasswordError("Mật khẩu xác nhận không khớp");
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
          Mật khẩu đã được cập nhật
        </Text>
        <Text className="mt-3 text-center text-base text-gray-500">
          Bạn có thể đăng nhập bằng mật khẩu mới.
        </Text>
        <View className="mt-8 w-full">
          <Button
            title="Đăng nhập"
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
            Đặt lại mật khẩu
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            Nhập mật khẩu mới cho tài khoản của bạn.
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Mật khẩu mới
            </Text>
            <TextInput
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                passwordError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="Ít nhất 6 ký tự"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (passwordError) setPasswordError("");
              }}
              secureTextEntry
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
              Xác nhận mật khẩu
            </Text>
            <TextInput
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                confirmPasswordError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="Nhập lại mật khẩu mới"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (confirmPasswordError) setConfirmPasswordError("");
              }}
              secureTextEntry
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
              title="Cập nhật mật khẩu"
              onPress={handleUpdate}
              loading={loading}
            />
          ) : (
            <Link href="/(auth)/forgot-password" asChild>
              <Text className="text-center text-sm font-semibold text-primary-600">
                Yêu cầu link mới
              </Text>
            </Link>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

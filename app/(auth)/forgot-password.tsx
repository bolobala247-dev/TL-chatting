import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useCooldown } from "@/src/hooks/useCooldown";
import { formatAuthFormError, logAuthErrorDebug } from "@/src/lib/authErrors";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const { resetPassword, loading } = useAuthStore();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const { cooldown, setCooldown } = useCooldown();

  const handleReset = async () => {
    setError("");
    if (!email.trim()) {
      setError("Vui lòng nhập email");
      return;
    }

    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err: unknown) {
      logAuthErrorDebug("ForgotPassword", err);
      const { message, cooldownSeconds } = formatAuthFormError(
        err,
        "Đã xảy ra lỗi, vui lòng thử lại",
        "password_reset",
      );
      setError(message);
      if (cooldownSeconds) setCooldown(cooldownSeconds);
    }
  };

  if (sent) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-5xl">✉️</Text>
        <Text className="mt-6 text-center text-xl font-bold text-gray-900">
          Kiểm tra email của bạn
        </Text>
        <Text className="mt-3 text-center text-base text-gray-500">
          Chúng tôi đã gửi link đặt lại mật khẩu đến{"\n"}
          <Text className="font-medium text-gray-700">{email}</Text>
        </Text>
        <View className="mt-8 w-full">
          <Button
            title="Quay lại đăng nhập"
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
            Quên mật khẩu?
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            Nhập email đã đăng ký, chúng tôi sẽ gửi link đặt lại mật khẩu.
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Email
            </Text>
            <TextInput
              className="h-12 rounded-xl border border-gray-300 bg-gray-50 px-4 text-base text-gray-900"
              placeholder="email@example.com"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              autoFocus
            />
          </View>

          {error ? (
            <Text className="text-sm text-red-600">{error}</Text>
          ) : null}

          <Button
            title={cooldown > 0 ? `Gửi lại sau (${cooldown}s)` : "Gửi link đặt lại"}
            onPress={handleReset}
            loading={loading}
            disabled={cooldown > 0}
          />

          <View className="mt-4 items-center">
            <Link href="/(auth)/login" asChild>
              <Text className="text-sm font-semibold text-primary-600">
                Quay lại đăng nhập
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

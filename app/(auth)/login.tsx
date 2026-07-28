import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link } from "expo-router";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";
import { PasswordInput } from "@/src/components/ui/PasswordInput";

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { signIn, loading } = useAuthStore();

  const handleLogin = async () => {
    setError("");
    if (!identifier.trim() || !password.trim()) {
      setError("Vui lòng nhập email/tên người dùng và mật khẩu");
      return;
    }

    try {
      await signIn(identifier.trim(), password);
    } catch (err: unknown) {
      console.error("[Login]", err);
      const msg =
        err instanceof Error ? err.message : "Đăng nhập thất bại, vui lòng thử lại";
      setError(msg);
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-1 justify-center px-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-10 items-center">
          <Text className="text-4xl font-bold text-black">
            Talo
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            Kết nối mọi lúc, mọi nơi
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Email hoặc tên người dùng
            </Text>
            <TextInput
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                error ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="email@example.com hoặc username"
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
              Mật khẩu
            </Text>
            <PasswordInput
              error={!!error}
              placeholder="Nhập mật khẩu"
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
                Quên mật khẩu?
              </Text>
            </Link>
          </View>

          {error ? (
            <Text className="text-sm text-red-600">{error}</Text>
          ) : null}

          <Button
            title="Đăng nhập"
            onPress={handleLogin}
            loading={loading}
          />

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-500">
              Chưa có tài khoản?
            </Text>
            <Link href="/(auth)/register" asChild>
              <Text className="text-sm font-semibold text-primary-600">
                Đăng ký ngay
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

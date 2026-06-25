import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import { Link } from "expo-router";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signIn, loading } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập email và mật khẩu");
      return;
    }

    try {
      await signIn(email.trim(), password);
    } catch (error: any) {
      Alert.alert("Đăng nhập thất bại", error.message);
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
          <Text className="text-4xl font-bold text-primary-600">
            TL Chat
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            Kết nối mọi lúc, mọi nơi
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
            />
          </View>

          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Mật khẩu
            </Text>
            <TextInput
              className="h-12 rounded-xl border border-gray-300 bg-gray-50 px-4 text-base text-gray-900"
              placeholder="Nhập mật khẩu"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
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

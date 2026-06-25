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

export default function RegisterScreen() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { signUp, loading } = useAuthStore();

  const handleRegister = async () => {
    if (!username.trim() || !email.trim() || !password.trim()) {
      Alert.alert("Lỗi", "Vui lòng điền đầy đủ thông tin");
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert("Lỗi", "Mật khẩu xác nhận không khớp");
      return;
    }

    if (password.length < 6) {
      Alert.alert("Lỗi", "Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }

    try {
      await signUp(email.trim(), password, username.trim());
      Alert.alert(
        "Đăng ký thành công",
        "Vui lòng kiểm tra email để xác thực tài khoản"
      );
    } catch (error: any) {
      Alert.alert("Đăng ký thất bại", error.message);
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
            Tạo tài khoản
          </Text>
          <Text className="mt-2 text-base text-gray-500">
            Đăng ký để bắt đầu trò chuyện
          </Text>
        </View>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Tên người dùng
            </Text>
            <TextInput
              className="h-12 rounded-xl border border-gray-300 bg-gray-50 px-4 text-base text-gray-900"
              placeholder="username"
              placeholderTextColor="#9CA3AF"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              textContentType="username"
              autoComplete="username"
            />
          </View>

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
              placeholder="Ít nhất 6 ký tự"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
            />
          </View>

          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Xác nhận mật khẩu
            </Text>
            <TextInput
              className="h-12 rounded-xl border border-gray-300 bg-gray-50 px-4 text-base text-gray-900"
              placeholder="Nhập lại mật khẩu"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
            />
          </View>

          <Button
            title="Đăng ký"
            onPress={handleRegister}
            loading={loading}
          />

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="text-sm text-gray-500">
              Đã có tài khoản?
            </Text>
            <Link href="/(auth)/login" asChild>
              <Text className="text-sm font-semibold text-primary-600">
                Đăng nhập
              </Text>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

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
import { useRouter } from "expo-router";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { updatePassword, loading } = useAuthStore();

  const handleUpdate = async () => {
    if (!password.trim()) {
      Alert.alert("Lỗi", "Vui lòng nhập mật khẩu mới");
      return;
    }
    if (password.length < 6) {
      Alert.alert("Lỗi", "Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Lỗi", "Mật khẩu xác nhận không khớp");
      return;
    }

    try {
      await updatePassword(password);
      Alert.alert("Thành công", "Mật khẩu đã được cập nhật", [
        { text: "OK", onPress: () => router.replace("/(auth)/login") },
      ]);
    } catch (error: any) {
      Alert.alert("Lỗi", error.message);
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
              placeholder="Nhập lại mật khẩu mới"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
            />
          </View>

          <Button
            title="Cập nhật mật khẩu"
            onPress={handleUpdate}
            loading={loading}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

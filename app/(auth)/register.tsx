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
import { profileService } from "@/src/services/profileService";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";
import { PasswordInput } from "@/src/components/ui/PasswordInput";

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,30}$/;

export default function RegisterScreen() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [success, setSuccess] = useState(false);
  const { cooldown, setCooldown } = useCooldown();
  const { signUp, loading } = useAuthStore();

  const handleRegister = async () => {
    setFormError("");
    setUsernameError("");
    setPasswordError("");
    setConfirmPasswordError("");

    if (!username.trim() || !email.trim() || !password.trim()) {
      setFormError("Vui lòng điền đầy đủ thông tin");
      return;
    }

    // Username dùng để đăng nhập nên không được chứa @ hay khoảng trắng
    if (!USERNAME_REGEX.test(username.trim())) {
      setUsernameError(
        "Tên người dùng chỉ gồm chữ, số, dấu chấm, gạch dưới, gạch nối (3-30 ký tự)",
      );
      return;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError("Mật khẩu xác nhận không khớp");
      return;
    }

    if (password.length < 6) {
      setPasswordError("Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }

    try {
      if (await profileService.isUsernameTaken(username.trim())) {
        setUsernameError("Tên người dùng đã được sử dụng");
        return;
      }

      const hasSession = await signUp(email.trim(), password, username.trim());
      // Có session ngay (auto-confirm) thì AuthGate tự chuyển vào app,
      // chỉ hiện màn "kiểm tra email" khi còn cần xác thực
      if (!hasSession) {
        setSuccess(true);
      }
    } catch (err: unknown) {
      logAuthErrorDebug("Register", err);
      const { message, cooldownSeconds } = formatAuthFormError(
        err,
        "Đăng ký thất bại, vui lòng thử lại",
        "signup",
      );
      setFormError(message);
      if (cooldownSeconds) setCooldown(cooldownSeconds);
    }
  };

  if (success) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-5xl">✉️</Text>
        <Text className="mt-6 text-center text-xl font-bold text-gray-900">
          Đăng ký thành công
        </Text>
        <Text className="mt-3 text-center text-base text-gray-500">
          Vui lòng kiểm tra email{"\n"}
          <Text className="font-medium text-gray-700">{email}</Text>
          {"\n"}để xác thực tài khoản.
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
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                formError || usernameError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="username"
              placeholderTextColor="#9CA3AF"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (formError) setFormError("");
                if (usernameError) setUsernameError("");
              }}
              autoCapitalize="none"
              textContentType="username"
              autoComplete="username"
            />
            {usernameError ? (
              <Text className="mt-1.5 text-sm text-red-600">{usernameError}</Text>
            ) : null}
          </View>

          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Email
            </Text>
            <TextInput
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                formError ? "border-red-500" : "border-gray-300"
              }`}
              placeholder="email@example.com"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (formError) setFormError("");
              }}
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
            <PasswordInput
              error={!!passwordError}
              placeholder="Ít nhất 6 ký tự"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (passwordError) setPasswordError("");
              }}
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
            <PasswordInput
              error={!!confirmPasswordError}
              placeholder="Nhập lại mật khẩu"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (confirmPasswordError) setConfirmPasswordError("");
              }}
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

          <Button
            title={cooldown > 0 ? `Đăng ký lại sau (${cooldown}s)` : "Đăng ký"}
            onPress={handleRegister}
            loading={loading}
            disabled={cooldown > 0}
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

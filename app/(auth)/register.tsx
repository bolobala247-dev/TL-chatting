import { useRef, useState } from "react";
import { View, Text, type TextInput } from "react-native";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/src/lib/keyboard";
import { useCooldown } from "@/src/hooks/useCooldown";
import { formatAuthFormError, logAuthErrorDebug } from "@/src/lib/authErrors";
import { profileService } from "@/src/services/profileService";
import { useAuthStore } from "@/src/stores/authStore";
import { Button } from "@/src/components/ui/Button";
import { PasswordInput } from "@/src/components/ui/PasswordInput";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { StatusScreen } from "@/src/components/ui/StatusScreen";

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,30}$/;

export default function RegisterScreen() {
  const { t } = useTranslation(["auth", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
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
      setFormError(t("validation.fillAllFields"));
      return;
    }

    // Username dùng để đăng nhập nên không được chứa @ hay khoảng trắng
    if (!USERNAME_REGEX.test(username.trim())) {
      setUsernameError(t("validation.usernameInvalid"));
      return;
    }

    if (password !== confirmPassword) {
      setConfirmPasswordError(t("validation.passwordMismatch"));
      return;
    }

    if (password.length < 6) {
      setPasswordError(t("validation.passwordTooShort"));
      return;
    }

    try {
      if (await profileService.isUsernameTaken(username.trim())) {
        setUsernameError(t("validation.usernameTaken"));
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
        t("errors.signupFailed"),
        "signup",
      );
      setFormError(message);
      if (cooldownSeconds) setCooldown(cooldownSeconds);
    }
  };

  if (success) {
    return (
      <StatusScreen
        icon={{ ios: "envelope", android: "mail", web: "mail" }}
        tone="info"
        title={t("register.successTitle")}
        message={
          <>
            {t("register.successCheckEmail")}{"\n"}
            <Text className="font-sans-medium text-fg">{email}</Text>
            {"\n"}{t("register.successVerify")}
          </>
        }
      >
        <Button
          title={t("register.signIn")}
          onPress={() => router.replace("/(auth)/login")}
        />
      </StatusScreen>
    );
  }

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerClassName="flex-grow justify-center px-6"
      contentContainerStyle={{
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
        <View className="mb-10 items-center">
          <Text className="font-sans-bold text-display text-ink">
            {t("register.title")}
          </Text>
          <Text className="mt-2 font-sans text-body text-fg-tertiary">
            {t("register.subtitle")}
          </Text>
        </View>

        <View className="gap-4">
          <TextField
            label={t("fields.username.label")}
            error={usernameError || !!formError}
            placeholder={t("fields.username.placeholder")}
            value={username}
            onChangeText={(text) => {
              setUsername(text);
              if (formError) setFormError("");
              if (usernameError) setUsernameError("");
            }}
            autoCapitalize="none"
            textContentType="username"
            autoComplete="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => emailRef.current?.focus()}
          />

          <TextField
            ref={emailRef}
            label={t("fields.email.label")}
            error={!!formError}
            placeholder={t("fields.email.placeholder")}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (formError) setFormError("");
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <PasswordInput
            ref={passwordRef}
            label={t("fields.password.label")}
            error={passwordError}
            placeholder={t("fields.passwordHint")}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (passwordError) setPasswordError("");
            }}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => confirmPasswordRef.current?.focus()}
          />

          <PasswordInput
            ref={confirmPasswordRef}
            label={t("fields.confirmPassword.label")}
            error={confirmPasswordError}
            placeholder={t("fields.confirmPassword.placeholder")}
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              if (confirmPasswordError) setConfirmPasswordError("");
            }}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="done"
            onSubmitEditing={handleRegister}
          />

          {formError ? <FormMessage>{formError}</FormMessage> : null}

          <Button
            title={
              cooldown > 0
                ? t("register.submitCooldown", { count: cooldown })
                : t("register.submit")
            }
            onPress={handleRegister}
            loading={loading}
            disabled={cooldown > 0}
          />

          <View className="mt-4 flex-row items-center justify-center gap-1">
            <Text className="font-sans text-caption text-fg-tertiary">
              {t("register.haveAccount")}
            </Text>
            <Link href="/(auth)/login" asChild>
              <Text className="font-sans-semibold text-caption text-ink">
                {t("register.signIn")}
              </Text>
            </Link>
          </View>
        </View>
    </KeyboardAwareScrollView>
  );
}

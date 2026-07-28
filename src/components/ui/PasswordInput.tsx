import { useState } from "react";
import { View, TextInput, Pressable, type TextInputProps } from "react-native";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";

interface PasswordInputProps extends TextInputProps {
  error?: boolean;
}

export function PasswordInput({ error = false, ...props }: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <View className="relative">
      <TextInput
        className={`h-12 rounded-xl border bg-gray-50 px-4 pr-12 text-base text-gray-900 ${
          error ? "border-red-500" : "border-gray-300"
        }`}
        placeholderTextColor="#9CA3AF"
        secureTextEntry={!visible}
        {...props}
      />
      <Pressable
        className="absolute right-0 top-0 h-12 w-12 items-center justify-center"
        onPress={() => setVisible((v) => !v)}
        hitSlop={8}
        accessibilityLabel={visible ? t("password.hide") : t("password.show")}
      >
        <SymbolView
          name={
            visible
              ? { ios: "eye.slash", android: "visibility_off", web: "visibility_off" }
              : { ios: "eye", android: "visibility", web: "visibility" }
          }
          tintColor="#9CA3AF"
          size={20}
        />
      </Pressable>
    </View>
  );
}

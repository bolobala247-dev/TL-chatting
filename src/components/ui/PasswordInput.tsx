import { useState } from "react";
import { Pressable, type TextInputProps } from "react-native";
import { useTranslation } from "react-i18next";
import { TextField } from "./TextField";
import { Icon } from "./Icon";

interface PasswordInputProps extends TextInputProps {
  label?: string;
  error?: string | boolean;
}

export function PasswordInput({
  label,
  error = false,
  ...props
}: PasswordInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      label={label}
      error={error}
      secureTextEntry={!visible}
      rightSlot={
        <Pressable
          className="h-12 w-12 items-center justify-center"
          onPress={() => setVisible((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={visible ? t("password.hide") : t("password.show")}
        >
          <Icon
            name={
              visible
                ? { ios: "eye.slash", android: "visibility_off", web: "visibility_off" }
                : { ios: "eye", android: "visibility", web: "visibility" }
            }
            tone="tertiary"
          />
        </Pressable>
      }
      {...props}
    />
  );
}

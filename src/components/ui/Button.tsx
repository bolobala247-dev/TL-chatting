import {
  Text,
  Pressable,
  ActivityIndicator,
  type PressableProps,
} from "react-native";
import { useThemeColors } from "@/src/theme";

interface ButtonProps extends PressableProps {
  title: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  loading?: boolean;
}

// Monochrome hierarchy (DESIGN_SYSTEM.md §16): primary = ink fill,
// secondary = quiet surface, ghost = text only, danger = tinted destructive
const variantStyles = {
  primary: {
    container: "bg-ink active:opacity-90",
    text: "text-ink-inverse",
  },
  secondary: {
    container: "bg-surface-secondary border border-border active:bg-pressed",
    text: "text-fg",
  },
  ghost: {
    container: "active:bg-pressed",
    text: "text-ink",
  },
  danger: {
    container: "bg-danger-bg active:opacity-90",
    text: "text-danger",
  },
};

const sizeStyles = {
  md: "h-11",
  lg: "h-12",
};

export function Button({
  title,
  variant = "primary",
  size = "lg",
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  const colors = useThemeColors();
  const styles = variantStyles[variant];
  const isDisabled = disabled || loading;
  const spinnerColor =
    variant === "primary"
      ? colors.inkInverse
      : variant === "danger"
        ? colors.danger
        : colors.fgSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      className={`items-center justify-center rounded-xl px-6 ${sizeStyles[size]} ${styles.container} ${isDisabled ? "opacity-50" : ""}`}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} size="small" />
      ) : (
        <Text className={`font-sans-semibold text-body ${styles.text}`}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

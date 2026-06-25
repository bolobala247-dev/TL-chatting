import {
  Text,
  Pressable,
  ActivityIndicator,
  type PressableProps,
} from "react-native";

interface ButtonProps extends PressableProps {
  title: string;
  variant?: "primary" | "secondary" | "ghost";
  loading?: boolean;
}

const variantStyles = {
  primary: {
    container: "bg-primary-600 active:bg-primary-700",
    text: "text-white font-semibold",
  },
  secondary: {
    container: "bg-gray-100 active:bg-gray-200 border border-gray-300",
    text: "text-gray-800 font-semibold",
  },
  ghost: {
    container: "active:bg-gray-100",
    text: "text-primary-600 font-semibold",
  },
};

export function Button({
  title,
  variant = "primary",
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  const styles = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      className={`h-12 items-center justify-center rounded-xl px-6 ${styles.container} ${isDisabled ? "opacity-50" : ""}`}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? "#FFFFFF" : "#3B82F6"}
          size="small"
        />
      ) : (
        <Text className={`text-base ${styles.text}`}>{title}</Text>
      )}
    </Pressable>
  );
}

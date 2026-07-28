import { Text } from "react-native";

interface FormMessageProps {
  tone?: "danger" | "success" | "info";
  children: string;
  className?: string;
}

const toneStyles = {
  danger: "text-danger",
  success: "text-success",
  info: "text-info",
};

/**
 * Single pattern for field/form feedback (DESIGN_SYSTEM.md §13) —
 * replaces the ad-hoc `text-sm text-red-600` copies.
 */
export function FormMessage({
  tone = "danger",
  children,
  className,
}: FormMessageProps) {
  return (
    <Text
      accessibilityRole="alert"
      className={`font-sans text-caption ${toneStyles[tone]} ${className ?? ""}`}
    >
      {children}
    </Text>
  );
}

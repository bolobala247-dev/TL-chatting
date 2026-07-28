import type { ReactNode } from "react";
import { View, Text } from "react-native";
import { useThemeColors } from "@/src/theme";
import { Icon, type IconName } from "./Icon";

interface StatusScreenProps {
  icon: IconName;
  tone?: "success" | "info";
  title: string;
  message: ReactNode;
  /** CTA area (usually one or two `Button`s). */
  children?: ReactNode;
}

const toneStyles = {
  success: "bg-success-bg",
  info: "bg-info-bg",
};

/**
 * Full-screen result layout (DESIGN_SYSTEM.md §16) — replaces the three
 * duplicated auth success screens.
 */
export function StatusScreen({
  icon,
  tone = "success",
  title,
  message,
  children,
}: StatusScreenProps) {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center bg-background px-8">
      <View
        className={`h-16 w-16 items-center justify-center rounded-full ${toneStyles[tone]}`}
      >
        <Icon name={icon} size="lg" color={colors[tone]} />
      </View>
      <Text className="mt-6 text-center font-sans-bold text-headline text-fg">
        {title}
      </Text>
      <Text className="mt-2 text-center font-sans text-body leading-6 text-fg-secondary">
        {message}
      </Text>
      {children ? <View className="mt-8 w-full">{children}</View> : null}
    </View>
  );
}

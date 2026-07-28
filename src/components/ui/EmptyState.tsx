import type { ReactNode } from "react";
import { View, Text } from "react-native";
import { Icon, type IconName } from "./Icon";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  /** Optional CTA rendered below the copy (usually a `Button`). */
  action?: ReactNode;
  className?: string;
}

/**
 * Single empty-state pattern (DESIGN_SYSTEM.md §13) — replaces the four
 * divergent empty layouts found in the audit.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
  className,
}: EmptyStateProps) {
  return (
    <View
      className={`flex-1 items-center justify-center px-8 ${className ?? ""}`}
    >
      <Icon name={icon} size="empty" tone="tertiary" />
      <Text className="mt-4 text-center font-sans-semibold text-title text-fg">
        {title}
      </Text>
      {subtitle ? (
        <Text className="mt-1.5 text-center font-sans text-caption leading-5 text-fg-tertiary">
          {subtitle}
        </Text>
      ) : null}
      {action ? <View className="mt-6">{action}</View> : null}
    </View>
  );
}

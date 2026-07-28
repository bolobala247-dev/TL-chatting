import { View, Text } from "react-native";

interface BadgeProps {
  label: string;
  className?: string;
}

/** Ink-filled count badge (unread counts etc.) — DESIGN_SYSTEM.md §16. */
export function Badge({ label, className }: BadgeProps) {
  return (
    <View
      className={`min-w-[20px] items-center justify-center rounded-full bg-ink px-1.5 py-0.5 ${className ?? ""}`}
    >
      <Text className="font-sans-semibold text-micro text-ink-inverse">
        {label}
      </Text>
    </View>
  );
}

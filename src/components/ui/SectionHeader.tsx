import { Text } from "react-native";

interface SectionHeaderProps {
  title: string;
  className?: string;
}

/** Uppercase section label used in settings-style screens. */
export function SectionHeader({ title, className }: SectionHeaderProps) {
  return (
    <Text
      accessibilityRole="header"
      className={`font-sans-medium text-label uppercase tracking-wide text-fg-tertiary ${className ?? ""}`}
    >
      {title}
    </Text>
  );
}

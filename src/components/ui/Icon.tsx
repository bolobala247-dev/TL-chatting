import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useThemeColors, iconSize } from "@/src/theme";

export type IconName = SymbolViewProps["name"];
export type IconTone =
  | "primary"
  | "secondary"
  | "tertiary"
  | "ink"
  | "inverse"
  | "danger"
  | "disabled";

interface IconProps {
  name: IconName;
  size?: keyof typeof iconSize | number;
  tone?: IconTone;
  /** Escape hatch for non-token colors (e.g. tab bar tint callbacks). */
  color?: string;
}

/**
 * Single icon entry point (DESIGN_SYSTEM.md §10) — screens never import
 * expo-symbols directly, so tones and sizes stay tokenized.
 */
export function Icon({ name, size = "md", tone = "secondary", color }: IconProps) {
  const colors = useThemeColors();
  const toneColor = {
    primary: colors.fg,
    secondary: colors.fgSecondary,
    tertiary: colors.fgTertiary,
    ink: colors.ink,
    inverse: colors.inkInverse,
    danger: colors.danger,
    disabled: colors.disabled,
  }[tone];

  return (
    <SymbolView
      name={name}
      tintColor={color ?? toneColor}
      size={typeof size === "number" ? size : iconSize[size]}
    />
  );
}

/**
 * JS-side mirror of the semantic color tokens defined in global.css.
 * Use these for props that cannot take a className (tintColor,
 * placeholderTextColor, navigation options, shadows, RefreshControl...).
 *
 * Raw hex values are only allowed here and in tailwind.config.ts /
 * global.css — never inline in screens or components (DESIGN_SYSTEM.md §4).
 */

export type ResolvedScheme = "light" | "dark";
export type ThemePreference = ResolvedScheme | "system";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceSecondary: string;
  card: string;
  border: string;
  divider: string;
  ink: string;
  inkInverse: string;
  fg: string;
  fgSecondary: string;
  fgTertiary: string;
  placeholder: string;
  disabled: string;
  hover: string;
  pressed: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;
  scrim: string;
}

export const lightColors: ThemeColors = {
  background: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceSecondary: "#FAFAFA",
  card: "#FAFAFA",
  border: "#E5E5E5",
  divider: "#F5F5F5",
  ink: "#000000",
  inkInverse: "#FFFFFF",
  fg: "#171717",
  fgSecondary: "#525252",
  fgTertiary: "#737373",
  placeholder: "#A3A3A3",
  disabled: "#D4D4D4",
  hover: "#FAFAFA",
  pressed: "#F5F5F5",
  success: "#15803D",
  successBg: "#F0FDF4",
  warning: "#A16207",
  warningBg: "#FFFBEB",
  danger: "#B91C1C",
  dangerBg: "#FEF2F2",
  info: "#1D4ED8",
  infoBg: "#EFF6FF",
  scrim: "rgba(0, 0, 0, 0.4)",
};

export const darkColors: ThemeColors = {
  background: "#0A0A0A",
  surface: "#0A0A0A",
  surfaceSecondary: "#171717",
  card: "#171717",
  border: "#262626",
  divider: "#171717",
  ink: "#FFFFFF",
  inkInverse: "#000000",
  fg: "#FAFAFA",
  fgSecondary: "#A3A3A3",
  fgTertiary: "#737373",
  placeholder: "#525252",
  disabled: "#404040",
  hover: "#171717",
  pressed: "#262626",
  success: "#4ADE80",
  successBg: "#0F2417",
  warning: "#FBBF24",
  warningBg: "#271E0B",
  danger: "#F87171",
  dangerBg: "#2A1212",
  info: "#60A5FA",
  infoBg: "#11203A",
  scrim: "rgba(0, 0, 0, 0.6)",
};

export const themeColors: Record<ResolvedScheme, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

/** Motion tokens (DESIGN_SYSTEM.md §9) for Animated/reanimated configs. */
export const motion = {
  durationFast: 120,
  durationBase: 200,
  durationSlow: 300,
} as const;

/**
 * elevation-overlay (DESIGN_SYSTEM.md §7) — the only shadow in the app.
 * Applied to dialogs/sheets/menus; combined with a hairline border in dark.
 */
export const elevationOverlay = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.08,
  shadowRadius: 24,
  elevation: 4,
} as const;

/** Icon size tokens (DESIGN_SYSTEM.md §10). */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  empty: 56,
} as const;

/** Avatar size tokens (DESIGN_SYSTEM.md §16). */
export const avatarSize = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 88,
} as const;

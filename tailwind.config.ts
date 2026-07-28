import type { Config } from "tailwindcss";

/**
 * Talo design tokens — see DESIGN_SYSTEM.md.
 *
 * All semantic colors resolve through CSS variables defined in global.css
 * (light values on :root, dark values on .dark:root) so every class is
 * automatically theme-aware. Raw hex values are only allowed here and in
 * src/theme/tokens.ts (kept in sync for JS-side props like tintColor).
 *
 * Radius mapping (Tailwind defaults already match the token scale):
 *   radius-sm → rounded-lg (8) · radius-md → rounded-xl (12)
 *   radius-lg → rounded-2xl (16) · radius-full → rounded-full
 */

function withVar(name: string) {
  return `rgb(var(${name}) / <alpha-value>)`;
}

export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ---- Semantic tokens (DESIGN_SYSTEM.md §4.2) ----
        background: withVar("--color-background"),
        surface: {
          DEFAULT: withVar("--color-surface"),
          secondary: withVar("--color-surface-secondary"),
        },
        card: withVar("--color-card"),
        border: withVar("--color-border"),
        divider: withVar("--color-divider"),
        ink: {
          DEFAULT: withVar("--color-ink"),
          inverse: withVar("--color-ink-inverse"),
        },
        // Text tones ("text-primary/secondary/tertiary" in the design doc —
        // named fg-* here to avoid colliding with the legacy primary bridge)
        fg: {
          DEFAULT: withVar("--color-fg"),
          secondary: withVar("--color-fg-secondary"),
          tertiary: withVar("--color-fg-tertiary"),
        },
        placeholder: withVar("--color-placeholder"),
        disabled: withVar("--color-disabled"),
        hover: withVar("--color-hover"),
        pressed: withVar("--color-pressed"),
        success: {
          DEFAULT: withVar("--color-success"),
          bg: withVar("--color-success-bg"),
        },
        warning: {
          DEFAULT: withVar("--color-warning"),
          bg: withVar("--color-warning-bg"),
        },
        danger: {
          DEFAULT: withVar("--color-danger"),
          bg: withVar("--color-danger-bg"),
        },
        info: {
          DEFAULT: withVar("--color-info"),
          bg: withVar("--color-info-bg"),
        },
      },
      // ---- Typography scale (DESIGN_SYSTEM.md §5) ----
      fontSize: {
        display: ["32px", { lineHeight: "38px", letterSpacing: "-0.32px" }],
        headline: ["24px", { lineHeight: "30px", letterSpacing: "-0.12px" }],
        title: ["17px", { lineHeight: "22px" }],
        body: ["15px", { lineHeight: "21px" }],
        caption: ["13px", { lineHeight: "17px" }],
        label: ["12px", { lineHeight: "15px", letterSpacing: "0.12px" }],
        micro: ["11px", { lineHeight: "13px", letterSpacing: "0.11px" }],
      },
      // Inter static faces — RN needs an explicit family per weight,
      // so weight utilities pair with these (e.g. "font-sans-semibold").
      fontFamily: {
        sans: ["Inter_400Regular"],
        "sans-medium": ["Inter_500Medium"],
        "sans-semibold": ["Inter_600SemiBold"],
        "sans-bold": ["Inter_700Bold"],
      },
      // ---- Motion (DESIGN_SYSTEM.md §9, web transitions) ----
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "300ms",
      },
      transitionTimingFunction: {
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        exit: "cubic-bezier(0.4, 0, 1, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;

import { useState } from "react";
import { View, TextInput, type TextInputProps } from "react-native";
import { useThemeColors } from "@/src/theme";
import { Icon } from "./Icon";

interface SearchFieldProps extends TextInputProps {
  containerClassName?: string;
}

/**
 * Pill search input (DESIGN_SYSTEM.md §16) — quiet surface, hairline
 * border appears on focus.
 */
export function SearchField({
  containerClassName,
  onFocus,
  onBlur,
  ...props
}: SearchFieldProps) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  return (
    <View
      className={`h-11 flex-row items-center gap-2.5 rounded-full border px-3.5 ${
        focused
          ? "border-border bg-surface"
          : "border-transparent bg-surface-secondary"
      } ${containerClassName ?? ""}`}
    >
      <Icon
        name={{ ios: "magnifyingglass", android: "search", web: "search" }}
        size="sm"
        tone="tertiary"
      />
      <TextInput
        className="flex-1 font-sans text-body text-fg"
        placeholderTextColor={colors.placeholder}
        returnKeyType="search"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
    </View>
  );
}

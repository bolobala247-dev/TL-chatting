import { useState, forwardRef, type ReactNode } from "react";
import { View, Text, TextInput, type TextInputProps } from "react-native";
import { useThemeColors } from "@/src/theme";
import { FormMessage } from "./FormMessage";

interface TextFieldProps extends TextInputProps {
  label?: string;
  /** `string` renders an inline message; `true` only tints the border. */
  error?: string | boolean;
  /** Trailing element inside the field (e.g. password visibility toggle). */
  rightSlot?: ReactNode;
  containerClassName?: string;
}

/**
 * Canonical text input (DESIGN_SYSTEM.md §16) — consolidates the input
 * styles previously duplicated across every auth screen and modal.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextField(
    {
      label,
      error,
      rightSlot,
      containerClassName,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) {
    const colors = useThemeColors();
    const [focused, setFocused] = useState(false);

    const borderClass = error
      ? "border-danger"
      : focused
        ? "border-ink"
        : "border-border";

    return (
      <View className={containerClassName}>
        {label ? (
          <Text className="mb-1.5 font-sans-medium text-caption text-fg-secondary">
            {label}
          </Text>
        ) : null}
        <View className="relative">
          <TextInput
            ref={ref}
            className={`h-12 rounded-xl border bg-surface-secondary px-4 font-sans text-body text-fg ${borderClass} ${rightSlot ? "pr-12" : ""}`}
            placeholderTextColor={colors.placeholder}
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
          {rightSlot ? (
            <View className="absolute right-0 top-0 h-12 w-12 items-center justify-center">
              {rightSlot}
            </View>
          ) : null}
        </View>
        {typeof error === "string" && error ? (
          <FormMessage className="mt-1.5">{error}</FormMessage>
        ) : null}
      </View>
    );
  }
);

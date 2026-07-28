import { View, TextInput, type TextInputProps } from "react-native";
import { useThemeColors } from "@/src/theme";
import { Icon } from "./Icon";

interface SearchFieldProps extends TextInputProps {
  containerClassName?: string;
}

/** Pill search input (DESIGN_SYSTEM.md §16) — quiet surface, no border. */
export function SearchField({ containerClassName, ...props }: SearchFieldProps) {
  const colors = useThemeColors();
  return (
    <View
      className={`h-10 flex-row items-center gap-2 rounded-full bg-surface-secondary px-3 ${containerClassName ?? ""}`}
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
        {...props}
      />
    </View>
  );
}

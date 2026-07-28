import { ActivityIndicator, View } from "react-native";
import { useThemeColors } from "@/src/theme";

interface SpinnerProps {
  size?: "small" | "large";
  color?: string;
  fullScreen?: boolean;
}

export function Spinner({ size = "large", color, fullScreen = false }: SpinnerProps) {
  const colors = useThemeColors();
  const tint = color ?? colors.fgTertiary;

  if (fullScreen) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size={size} color={tint} />
      </View>
    );
  }

  return <ActivityIndicator size={size} color={tint} />;
}

/** @deprecated Use `Spinner` — alias kept until migration Phase 6. */
export const LoadingSpinner = Spinner;

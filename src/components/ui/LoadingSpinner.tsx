import { ActivityIndicator, View } from "react-native";

interface LoadingSpinnerProps {
  size?: "small" | "large";
  color?: string;
  fullScreen?: boolean;
}

export function LoadingSpinner({
  size = "large",
  color = "#3B82F6",
  fullScreen = false,
}: LoadingSpinnerProps) {
  if (fullScreen) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size={size} color={color} />
      </View>
    );
  }

  return <ActivityIndicator size={size} color={color} />;
}

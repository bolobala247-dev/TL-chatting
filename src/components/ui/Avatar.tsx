import { View, Text } from "react-native";
import { Image } from "expo-image";

interface AvatarProps {
  uri?: string | null;
  name?: string | null;
  size?: number;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const bgColors = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-red-500",
];

function getColorForName(name: string | null | undefined): string {
  if (!name) return bgColors[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return bgColors[Math.abs(hash) % bgColors.length];
}

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={200}
      />
    );
  }

  const initials = getInitials(name);
  const bgColor = getColorForName(name);
  const fontSize = size * 0.4;

  return (
    <View
      className={`items-center justify-center ${bgColor}`}
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      <Text
        className="font-bold text-white"
        style={{ fontSize }}
      >
        {initials}
      </Text>
    </View>
  );
}

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

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={200}
        // Avatars repeat across recycled list rows — memory cache avoids
        // disk hits, recyclingKey prevents stale frames while recycling
        cachePolicy="memory-disk"
        recyclingKey={uri}
      />
    );
  }

  const initials = getInitials(name);
  const fontSize = size * 0.4;

  // Monochrome fallback (DESIGN_SYSTEM.md §16) — content brings the color,
  // the chrome never does
  return (
    <View
      className="items-center justify-center border border-border bg-surface-secondary"
      style={{ width: size, height: size, borderRadius: size / 2 }}
    >
      <Text
        className="font-sans-semibold text-fg-secondary"
        style={{ fontSize }}
      >
        {initials}
      </Text>
    </View>
  );
}

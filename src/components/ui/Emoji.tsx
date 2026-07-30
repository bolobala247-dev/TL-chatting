import { Platform, Text } from "react-native";
import { Image } from "expo-image";

// Twemoji filename convention: iterate by code points and drop the FE0F
// variation selector unless the emoji contains a ZWJ sequence.
function toCodePoint(emoji: string): string {
  const cleaned = emoji.includes("\u200d")
    ? emoji
    : emoji.replace(/\ufe0f/g, "");
  return [...cleaned]
    .map((c) => c.codePointAt(0)!.toString(16))
    .join("-");
}

interface EmojiProps {
  emoji: string;
  size?: number;
}

// Web: browser emoji fonts (Segoe UI Emoji…) look off-brand — render
// Twemoji SVGs instead. Native keeps the system emoji (Apple/Noto).
export function Emoji({ emoji, size = 20 }: EmojiProps) {
  if (Platform.OS !== "web") {
    return (
      <Text style={{ fontSize: size, lineHeight: size + 4 }}>{emoji}</Text>
    );
  }

  return (
    <Image
      source={{
        uri: `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${toCodePoint(emoji)}.svg`,
      }}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessibilityLabel={emoji}
    />
  );
}

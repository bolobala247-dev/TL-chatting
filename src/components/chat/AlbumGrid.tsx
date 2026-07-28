import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import type { MessageAttachment } from "@/src/types";

// Fixed footprint per count keeps FlashList measurement stable
const GRID_W = 220;
const GAP = 2;

interface TileProps {
  attachment: MessageAttachment;
  width: number;
  height: number;
  overlayCount?: number;
  onPress?: () => void;
}

function Tile({ attachment, width, height, overlayCount, onPress }: TileProps) {
  return (
    <Pressable onPress={onPress} accessibilityRole="imagebutton">
      <Image
        source={{ uri: attachment.url }}
        style={{ width, height }}
        contentFit="cover"
        transition={200}
        recyclingKey={attachment.url}
      />
      {overlayCount ? (
        <View className="absolute inset-0 items-center justify-center bg-black/50">
          <Text className="font-sans-semibold text-title text-white">
            +{overlayCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

interface AlbumGridProps {
  attachments: MessageAttachment[];
  onPressImage?: (index: number) => void;
}

// Album layout: 1 full, 2 columns, 3 = large + stacked pair, 4+ = 2×2 with +N
export function AlbumGrid({ attachments, onPressImage }: AlbumGridProps) {
  const count = attachments.length;
  if (count === 0) return null;

  const press = (index: number) => () => onPressImage?.(index);

  if (count === 1) {
    return (
      <View className="mb-1 overflow-hidden rounded-xl">
        <Tile
          attachment={attachments[0]}
          width={GRID_W}
          height={180}
          onPress={press(0)}
        />
      </View>
    );
  }

  if (count === 2) {
    const w = (GRID_W - GAP) / 2;
    return (
      <View className="mb-1 flex-row overflow-hidden rounded-xl" style={{ gap: GAP }}>
        <Tile attachment={attachments[0]} width={w} height={140} onPress={press(0)} />
        <Tile attachment={attachments[1]} width={w} height={140} onPress={press(1)} />
      </View>
    );
  }

  if (count === 3) {
    const largeW = 146;
    const smallW = GRID_W - GAP - largeW;
    const smallH = (184 - GAP) / 2;
    return (
      <View className="mb-1 flex-row overflow-hidden rounded-xl" style={{ gap: GAP }}>
        <Tile attachment={attachments[0]} width={largeW} height={184} onPress={press(0)} />
        <View style={{ gap: GAP }}>
          <Tile attachment={attachments[1]} width={smallW} height={smallH} onPress={press(1)} />
          <Tile attachment={attachments[2]} width={smallW} height={smallH} onPress={press(2)} />
        </View>
      </View>
    );
  }

  // 4+: 2×2, the last tile carries a +N scrim for the hidden rest
  const w = (GRID_W - GAP) / 2;
  const hidden = count - 4;
  return (
    <View className="mb-1 overflow-hidden rounded-xl" style={{ gap: GAP }}>
      <View className="flex-row" style={{ gap: GAP }}>
        <Tile attachment={attachments[0]} width={w} height={w} onPress={press(0)} />
        <Tile attachment={attachments[1]} width={w} height={w} onPress={press(1)} />
      </View>
      <View className="flex-row" style={{ gap: GAP }}>
        <Tile attachment={attachments[2]} width={w} height={w} onPress={press(2)} />
        <Tile
          attachment={attachments[3]}
          width={w}
          height={w}
          overlayCount={hidden > 0 ? hidden : undefined}
          onPress={press(3)}
        />
      </View>
    </View>
  );
}

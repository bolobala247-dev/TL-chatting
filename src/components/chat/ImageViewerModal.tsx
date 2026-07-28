import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import type { MessageAttachment } from "@/src/types";

interface ImageViewerModalProps {
  attachments: MessageAttachment[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}

// Minimal full-screen album viewer: paged images, n/m indicator, close
export function ImageViewerModal({
  attachments,
  initialIndex,
  visible,
  onClose,
}: ImageViewerModalProps) {
  const { t } = useTranslation("common");
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(initialIndex);

  // Jump to the tapped image every time the viewer opens
  useEffect(() => {
    if (!visible) return;
    setPage(initialIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: initialIndex * width, animated: false });
    });
  }, [visible, initialIndex, width]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black">
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
        >
          {attachments.map((attachment) => (
            <View
              key={attachment.url}
              style={{ width, height }}
              className="items-center justify-center"
            >
              <Image
                source={{ uri: attachment.url }}
                style={{ width, height: height * 0.8 }}
                contentFit="contain"
                transition={150}
              />
            </View>
          ))}
        </ScrollView>

        <View
          className="absolute left-0 right-0 flex-row items-center justify-between px-2"
          style={{ top: insets.top + 4 }}
        >
          {/* Fixed white regardless of theme — the scrim is always black */}
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
            accessibilityRole="button"
            accessibilityLabel={t("actions.close")}
            onPress={onClose}
          >
            <Icon
              name={{ ios: "xmark", android: "close", web: "close" }}
              color="#FFFFFF"
            />
          </Pressable>
          {attachments.length > 1 && (
            <View className="rounded-full bg-black/50 px-3 py-1">
              <Text className="font-sans-medium text-caption text-white">
                {page + 1}/{attachments.length}
              </Text>
            </View>
          )}
          {/* Spacer keeps the indicator centered */}
          <View className="h-11 w-11" />
        </View>
      </View>
    </Modal>
  );
}

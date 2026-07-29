import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors, elevationOverlay, motion } from "@/src/theme";

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

// Spring used for both the slide-in and the snap-back after a drag
const SHEET_SPRING = { damping: 28, stiffness: 320, mass: 0.8 };
/** Drag distance past which releasing dismisses the sheet. */
const DISMISS_DISTANCE = 100;
/** Fling velocity (pt/s) that dismisses regardless of distance. */
const DISMISS_VELOCITY = 900;
/** Sheets stay phone-sized on tablets instead of stretching edge to edge. */
const SHEET_MAX_WIDTH = 480;

/**
 * Bottom sheet as a floating card (DESIGN_SYSTEM.md §16) — matches the
 * existing MessageActions layout so migrating it is a pure re-skin.
 *
 * Native adds mobile affordances: spring slide-up, scrim fade and a grab
 * handle that can be dragged down to dismiss. Web keeps the static modal.
 */
export function Sheet(props: SheetProps) {
  if (Platform.OS === "web") {
    return <StaticSheet {...props} />;
  }
  return <AnimatedSheet {...props} />;
}

function AnimatedSheet({ visible, onClose, children }: SheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // The Modal stays mounted while the exit animation plays out
  const [rendered, setRendered] = useState(visible);

  const progress = useSharedValue(0); // 0 = hidden, 1 = fully shown
  const dragY = useSharedValue(0);

  const finishClose = useCallback(() => setRendered(false), []);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      dragY.value = 0;
      progress.value = withSpring(1, SHEET_SPRING);
    } else if (rendered) {
      progress.value = withTiming(
        0,
        { duration: motion.durationFast },
        (finished) => {
          if (finished) runOnJS(finishClose)();
        }
      );
    }
  }, [visible, rendered, progress, dragY, finishClose]);

  // Drag lives on the grab handle only, so sheets hosting scrollable
  // content never fight the pan gesture
  const pan = Gesture.Pan()
    .onChange((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (dragY.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      } else {
        dragY.value = withSpring(0, SHEET_SPRING);
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: (1 - progress.value) * 480 + dragY.value },
    ],
  }));

  return (
    <Modal
      visible={rendered}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end px-3">
        <Animated.View
          style={[
            { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
            scrimStyle,
          ]}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={onClose}
            accessibilityLabel="Đóng"
          />
        </Animated.View>

        <Animated.View
          style={[
            elevationOverlay,
            {
              width: "100%",
              maxWidth: SHEET_MAX_WIDTH,
              alignSelf: "center",
              // Clears the home indicator on gesture-nav devices, keeps a
              // consistent gap on devices without a bottom inset
              marginBottom: Math.max(insets.bottom, 16) + 8,
            },
            cardStyle,
          ]}
        >
          <View className="overflow-hidden rounded-2xl border border-border bg-surface">
            <GestureDetector gesture={pan}>
              <View className="items-center py-2.5">
                <View className="h-1 w-9 rounded-full bg-border" />
              </View>
            </GestureDetector>
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** Web fallback — unchanged static modal card. */
function StaticSheet({ visible, onClose, children }: SheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: colors.scrim }}
        onPress={onClose}
        accessibilityLabel="Đóng"
      >
        <View
          className="mx-3 overflow-hidden rounded-2xl border border-border bg-surface"
          style={[elevationOverlay, { marginBottom: Math.max(insets.bottom, 16) + 8 }]}
        >
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/tabs";
import { useThemeColors, elevationFloat, motion, iconSize } from "@/src/theme";
import { Badge } from "./Badge";

/** Fixed height of the floating capsule (excludes the safe-area gap). */
export const TAB_BAR_HEIGHT = 64;
/** Minimum gap between the capsule and the bottom edge of the screen. */
export const TAB_BAR_BOTTOM_MARGIN = 12;

/**
 * Bottom space screens must reserve so scroll content and floating
 * buttons clear the floating tab bar.
 */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return (
    Math.max(insets.bottom, TAB_BAR_BOTTOM_MARGIN) + TAB_BAR_HEIGHT + 12
  );
}

interface TabBarItemProps {
  focused: boolean;
  label: string;
  icon?: ReactNode;
  badge?: number | string;
  onPress: () => void;
  onLongPress: () => void;
}

function TabBarItem({
  focused,
  label,
  icon,
  badge,
  onPress,
  onLongPress,
}: TabBarItemProps) {
  // Subtle fade+scale of the active pill — fast, no fancy effects
  const anim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: focused ? 1 : 0,
      duration: motion.durationFast,
      useNativeDriver: true,
    }).start();
  }, [focused, anim]);

  return (
    <Pressable
      className="h-full flex-1 items-center justify-center"
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      {/* Animated wrapper keeps plain styles — NativeWind classes live on the inner View */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 8,
          bottom: 8,
          opacity: anim,
          transform: [
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        }}
      >
        <View className="flex-1 rounded-full bg-surface-secondary" />
      </Animated.View>
      <View className="items-center gap-1">
        <View>
          {icon}
          {badge != null ? (
            <Badge label={String(badge)} className="absolute -right-3 -top-1.5" />
          ) : null}
        </View>
        <Text
          className={`text-micro ${
            focused
              ? "font-sans-semibold text-ink"
              : "font-sans-medium text-fg-tertiary"
          }`}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Floating pill tab bar (DESIGN_SYSTEM.md §16) — full-width capsule above
 * the safe area, flat surface with hairline border and a soft float shadow.
 * Reuses the navigation state/descriptors provided by expo-router Tabs.
 */
export function FloatingTabBar({
  state,
  descriptors,
  navigation,
  insets,
}: BottomTabBarProps) {
  const colors = useThemeColors();

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 bottom-0"
      style={{ paddingBottom: Math.max(insets.bottom, TAB_BAR_BOTTOM_MARGIN) }}
    >
      <View
        className="mx-4 flex-row overflow-visible rounded-full border border-border bg-surface"
        style={[{ height: TAB_BAR_HEIGHT }, elevationFloat]}
      >
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;
          const { options } = descriptor;
          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : options.title ?? route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          return (
            <TabBarItem
              key={route.key}
              focused={focused}
              label={label}
              icon={options.tabBarIcon?.({
                focused,
                color: focused ? colors.ink : colors.fgTertiary,
                size: iconSize.lg,
              })}
              badge={options.tabBarBadge}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
}

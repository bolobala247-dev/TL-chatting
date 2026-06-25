import { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";

interface TypingIndicatorProps {
  typingUsers: Array<{ user_id: string; display_name: string }>;
}

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ])
      );

    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 150);
    const a3 = animate(dot3, 300);
    a1.start();
    a2.start();
    a3.start();

    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, []);

  return (
    <View className="flex-row items-center gap-1">
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-gray-400"
          style={{
            opacity: dot.interpolate({
              inputRange: [0, 1],
              outputRange: [0.3, 1],
            }),
          }}
        />
      ))}
    </View>
  );
}

export function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const names = typingUsers.map((u) => u.display_name);
  let text: string;

  if (names.length === 1) {
    text = `${names[0]} đang nhập`;
  } else if (names.length === 2) {
    text = `${names[0]} và ${names[1]} đang nhập`;
  } else {
    text = `${names.length} người đang nhập`;
  }

  return (
    <View className="flex-row items-center gap-2 px-4 py-1.5">
      <TypingDots />
      <Text className="text-xs text-gray-400">{text}</Text>
    </View>
  );
}

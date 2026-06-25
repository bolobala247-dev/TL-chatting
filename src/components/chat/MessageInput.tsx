import { useState, useRef } from "react";
import { View, TextInput, Pressable, Platform } from "react-native";
import { SymbolView } from "expo-symbols";

interface MessageInputProps {
  onSend: (content: string) => void;
  onAttach?: () => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
}

export function MessageInput({
  onSend,
  onAttach,
  onTypingStart,
  onTypingStop,
}: MessageInputProps) {
  const [text, setText] = useState("");
  const typingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChangeText = (value: string) => {
    setText(value);

    if (value.length > 0 && !typingRef.current) {
      typingRef.current = true;
      onTypingStart?.();
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      typingRef.current = false;
      onTypingStop?.();
    }, 2000);
  };

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
    typingRef.current = false;
    onTypingStop?.();
    clearTimeout(typingTimeoutRef.current);
  };

  const hasText = text.trim().length > 0;

  return (
    <View className="flex-row items-end gap-2 border-t border-gray-100 bg-white px-3 py-2">
      {onAttach && (
        <Pressable
          className="mb-1.5 h-9 w-9 items-center justify-center rounded-full active:bg-gray-100"
          onPress={onAttach}
        >
          <SymbolView
            name={{ ios: "plus.circle.fill", android: "add_circle", web: "add_circle" }}
            tintColor="#9CA3AF"
            size={24}
          />
        </Pressable>
      )}

      <View className="min-h-[36px] flex-1 justify-center rounded-2xl bg-gray-100 px-4 py-2">
        <TextInput
          className="max-h-24 text-[15px] leading-5 text-gray-900"
          placeholder="Nhập tin nhắn..."
          placeholderTextColor="#9CA3AF"
          value={text}
          onChangeText={handleChangeText}
          multiline
          textAlignVertical="center"
          returnKeyType="default"
          blurOnSubmit={false}
          onSubmitEditing={Platform.OS === "web" ? handleSend : undefined}
        />
      </View>

      <Pressable
        className={`mb-1.5 h-9 w-9 items-center justify-center rounded-full ${
          hasText ? "bg-primary-600 active:bg-primary-700" : ""
        }`}
        onPress={handleSend}
        disabled={!hasText}
      >
        <SymbolView
          name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }}
          tintColor={hasText ? "#FFFFFF" : "#D1D5DB"}
          size={18}
        />
      </Pressable>
    </View>
  );
}

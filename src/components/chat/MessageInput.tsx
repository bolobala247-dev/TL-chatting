import { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { View, TextInput, Pressable, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { useThemeColors } from "@/src/theme";

interface MessageInputProps {
  onSend: (content: string) => void;
  onAttach?: () => void;
  /** Long-press on the send button — used to schedule the drafted message. */
  onLongPressSend?: (content: string) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
}

export interface MessageInputHandle {
  /** Restore composer text (e.g. after undoing a send). */
  setText: (value: string) => void;
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(
  function MessageInput(
    { onSend, onAttach, onLongPressSend, onTypingStart, onTypingStop },
    ref
  ) {
  const { t } = useTranslation("chat");
  const colors = useThemeColors();
  const [text, setText] = useState("");
  const typingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useImperativeHandle(ref, () => ({ setText }), []);

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

  const handleLongPressSend = () => {
    if (!text.trim() || !onLongPressSend) return;
    onLongPressSend(text.trim());
    setText("");
    typingRef.current = false;
    onTypingStop?.();
    clearTimeout(typingTimeoutRef.current);
  };

  const hasText = text.trim().length > 0;

  return (
    <View className="flex-row items-end gap-2 border-t border-divider bg-surface px-3 py-2">
      {onAttach && (
        <Pressable
          className="mb-1.5 h-9 w-9 items-center justify-center rounded-full active:bg-pressed"
          onPress={onAttach}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("input.attach")}
        >
          <Icon
            name={{ ios: "plus.circle.fill", android: "add_circle", web: "add_circle" }}
            tone="tertiary"
            size="lg"
          />
        </Pressable>
      )}

      <View className="min-h-[36px] flex-1 justify-center rounded-2xl bg-surface-secondary px-4 py-2">
        <TextInput
          className="max-h-24 font-sans text-body leading-5 text-fg"
          placeholder={t("input.placeholder")}
          placeholderTextColor={colors.placeholder}
          value={text}
          onChangeText={handleChangeText}
          multiline
          textAlignVertical="center"
          returnKeyType="default"
          submitBehavior="newline"
          onSubmitEditing={Platform.OS === "web" ? handleSend : undefined}
        />
      </View>

      <Pressable
        className={`mb-1.5 h-9 w-9 items-center justify-center rounded-full ${
          hasText ? "bg-ink active:opacity-90" : ""
        }`}
        onPress={handleSend}
        onLongPress={onLongPressSend ? handleLongPressSend : undefined}
        delayLongPress={350}
        disabled={!hasText}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("input.send")}
      >
        <Icon
          name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }}
          color={hasText ? colors.inkInverse : colors.disabled}
          size={18}
        />
      </Pressable>
    </View>
  );
  }
);

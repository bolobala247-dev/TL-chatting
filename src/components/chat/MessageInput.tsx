import { useRef } from "react";
import { View, TextInput, Pressable, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { useThemeColors } from "@/src/theme";

interface MessageInputProps {
  /** Controlled text — the screen owns it so drafts can persist. */
  value: string;
  onChangeText: (value: string) => void;
  onSend: (content: string) => void;
  onAttach?: () => void;
  /** Long-press on the send button — used to schedule the drafted message. */
  onLongPressSend?: (content: string) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
}

export function MessageInput({
  value,
  onChangeText,
  onSend,
  onAttach,
  onLongPressSend,
  onTypingStart,
  onTypingStop,
}: MessageInputProps) {
  const { t } = useTranslation("chat");
  const colors = useThemeColors();
  const typingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChangeText = (next: string) => {
    onChangeText(next);

    if (next.length > 0 && !typingRef.current) {
      typingRef.current = true;
      onTypingStart?.();
    }

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      typingRef.current = false;
      onTypingStop?.();
    }, 2000);
  };

  const endTyping = () => {
    typingRef.current = false;
    onTypingStop?.();
    clearTimeout(typingTimeoutRef.current);
  };

  const handleSend = () => {
    if (!value.trim()) return;
    onSend(value.trim());
    endTyping();
  };

  const handleLongPressSend = () => {
    if (!value.trim() || !onLongPressSend) return;
    onLongPressSend(value.trim());
    endTyping();
  };

  const hasText = value.trim().length > 0;

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
          value={value}
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

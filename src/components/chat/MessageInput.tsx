import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  View,
  TextInput,
  Pressable,
  Platform,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { useThemeColors } from "@/src/theme";

// Lazy: the picker (UI + emoji dataset) only loads on first open
const EmojiPicker = lazy(() => import("./EmojiPicker"));

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

  // Mirror of the controlled value so emoji inserts stay stable callbacks
  const valueRef = useRef(value);
  valueRef.current = value;
  // Last known cursor — emoji picks land here even after focus is lost
  const selectionRef = useRef({ start: value.length, end: value.length });
  // One-shot controlled selection to restore the cursor after an insert
  const [forcedSelection, setForcedSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const [emojiMounted, setEmojiMounted] = useState(false);
  const [emojiVisible, setEmojiVisible] = useState(false);

  const handleChangeText = useCallback(
    (next: string) => {
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
    },
    [onChangeText, onTypingStart, onTypingStop]
  );

  const handleSelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>
  ) => {
    selectionRef.current = e.nativeEvent.selection;
    // Release the one-shot selection once the input has applied it
    if (forcedSelection) setForcedSelection(null);
  };

  const openEmojiPicker = () => {
    setEmojiMounted(true);
    setEmojiVisible(true);
  };

  const closeEmojiPicker = useCallback(() => setEmojiVisible(false), []);

  // Splice the emoji in at the cursor and park the caret right after it —
  // works mid-text and across multiline content
  const handlePickEmoji = useCallback(
    (emoji: string) => {
      const current = valueRef.current;
      const start = Math.min(selectionRef.current.start, current.length);
      const end = Math.min(
        Math.max(selectionRef.current.end, start),
        current.length
      );
      const cursor = start + emoji.length;
      selectionRef.current = { start: cursor, end: cursor };
      setForcedSelection({ start: cursor, end: cursor });
      handleChangeText(current.slice(0, start) + emoji + current.slice(end));
    },
    [handleChangeText]
  );

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

  // Web: Enter gửi tin, Shift+Enter mới xuống dòng.
  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== "web") return;
    const native = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
    if (native.key === "Enter" && !native.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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

      <View className="min-h-[36px] flex-1 flex-row items-end rounded-2xl bg-surface-secondary pl-4 pr-1">
        <TextInput
          className="max-h-24 flex-1 py-2 font-sans text-body leading-5 text-fg"
          placeholder={t("input.placeholder")}
          placeholderTextColor={colors.placeholder}
          value={value}
          onChangeText={handleChangeText}
          multiline
          textAlignVertical="center"
          returnKeyType="default"
          submitBehavior="newline"
          onKeyPress={handleKeyPress}
          onSelectionChange={handleSelectionChange}
          selection={forcedSelection ?? undefined}
        />
        <Pressable
          className="mb-1 h-7 w-7 items-center justify-center rounded-full active:bg-pressed"
          onPress={openEmojiPicker}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("input.emoji")}
        >
          <Icon
            name={{ ios: "face.smiling", android: "mood", web: "mood" }}
            tone="tertiary"
            size="md"
          />
        </Pressable>
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

      {emojiMounted && (
        <Suspense fallback={null}>
          <EmojiPicker
            visible={emojiVisible}
            onClose={closeEmojiPicker}
            onPick={handlePickEmoji}
          />
        </Suspense>
      )}
    </View>
  );
}

import { View, Text, Pressable, Linking } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import type { Message } from "@/src/types";
import { useAuthStore } from "@/src/stores/authStore";
import { useChatStore } from "@/src/stores/chatStore";
import { Icon } from "@/src/components/ui/Icon";

interface MessageBubbleProps {
  message: Message;
  onLongPress?: (message: Message) => void;
}

function formatTime(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function ReplyContext({ replyToId, roomId }: { replyToId: string; roomId: string }) {
  const { t } = useTranslation("chat");
  const messages = useChatStore((s) => s.messages[roomId] ?? []);
  const replyMessage = messages.find((m) => m.id === replyToId);

  if (!replyMessage) return null;

  const preview = replyMessage.deleted_at
    ? t("message.deleted")
    : replyMessage.content || t("message.imagePlaceholder");

  return (
    <View className="mb-1.5 rounded-lg border-l-2 border-border bg-ink/5 px-2.5 py-1.5">
      <Text className="font-sans text-label text-fg-tertiary" numberOfLines={1}>
        {preview}
      </Text>
    </View>
  );
}

export function MessageBubble({ message, onLongPress }: MessageBubbleProps) {
  const { t, i18n } = useTranslation("chat");
  const userId = useAuthStore((s) => s.user?.id);
  const isMine = message.sender_id === userId;
  const isDeleted = !!message.deleted_at;

  if (message.type === "system") {
    return (
      <View className="my-1 items-center px-4">
        <Text className="font-sans text-label text-fg-tertiary">{message.content}</Text>
      </View>
    );
  }

  return (
    <Pressable
      className={`my-0.5 max-w-[80%] px-3 ${isMine ? "self-end" : "self-start"}`}
      onLongPress={isDeleted ? undefined : () => onLongPress?.(message)}
      delayLongPress={300}
    >
      <View
        className={`rounded-2xl px-3.5 py-2.5 ${
          isMine
            ? "rounded-br-md bg-ink"
            : "rounded-bl-md bg-surface-secondary border border-border"
        }`}
      >
        {!isDeleted && message.reply_to && (
          <ReplyContext replyToId={message.reply_to} roomId={message.room_id} />
        )}

        {isDeleted ? (
          <Text
            className={`font-sans italic text-body leading-5 ${
              isMine ? "text-ink-inverse/70" : "text-fg-tertiary"
            }`}
          >
            {t("message.deleted")}
          </Text>
        ) : (
          <>
            {message.type === "image" && message.media_url && (
              <View className="mb-1 overflow-hidden rounded-xl">
                <Image
                  source={{ uri: message.media_url }}
                  style={{ width: 220, height: 180 }}
                  contentFit="cover"
                  transition={200}
                />
              </View>
            )}

            {(message.type === "video" || message.type === "file") &&
              message.media_url && (
                <Pressable
                  className={`mb-1 flex-row items-center gap-2 rounded-xl px-3 py-2.5 ${
                    isMine ? "bg-ink-inverse/10" : "bg-ink/5"
                  }`}
                  onPress={() => Linking.openURL(message.media_url!)}
                  accessibilityRole="button"
                >
                  <Icon
                    name={
                      message.type === "video"
                        ? { ios: "play.circle.fill", android: "play_circle", web: "play_circle" }
                        : { ios: "doc.fill", android: "description", web: "description" }
                    }
                    tone={isMine ? "inverse" : "secondary"}
                    size="md"
                  />
                  <Text
                    className={`flex-1 font-sans text-body ${
                      isMine ? "text-ink-inverse" : "text-fg"
                    }`}
                    numberOfLines={1}
                  >
                    {message.type === "video"
                      ? t("message.videoPlaceholder")
                      : t("message.filePlaceholder")}
                  </Text>
                </Pressable>
              )}

            {message.content && (
              <Text
                className={`font-sans text-body leading-5 ${
                  isMine ? "text-ink-inverse" : "text-fg"
                }`}
              >
                {message.content}
              </Text>
            )}
          </>
        )}

        <View
          className={`mt-1 flex-row items-center gap-1 ${isMine ? "justify-end" : ""}`}
        >
          <Text
            className={`font-sans text-micro ${
              isMine ? "text-ink-inverse/60" : "text-fg-tertiary"
            }`}
          >
            {message.created_at ? formatTime(message.created_at, i18n.language) : ""}
          </Text>
          {!isDeleted && message.is_edited && (
            <Text
              className={`font-sans text-micro ${
                isMine ? "text-ink-inverse/60" : "text-fg-tertiary"
              }`}
            >
              {t("message.edited")}
            </Text>
          )}
          {!isDeleted && message.pinned_at && (
            <Icon
              name={{ ios: "pin.fill", android: "keep", web: "keep" }}
              tone={isMine ? "inverse" : "tertiary"}
              size={11}
            />
          )}
        </View>
      </View>
    </Pressable>
  );
}

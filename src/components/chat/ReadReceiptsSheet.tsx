import { useMemo } from "react";
import { View, Text, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/src/stores/chatStore";
import { hasSeen } from "@/src/lib/receipts";
import { Avatar } from "@/src/components/ui/Avatar";
import { Sheet } from "@/src/components/ui/Sheet";
import type { MessageWithMeta } from "@/src/types";

interface ReadReceiptsSheetProps {
  message: MessageWithMeta | null;
  visible: boolean;
  onClose: () => void;
}

// "Seen by" list for an own message, derived from participant watermarks
export function ReadReceiptsSheet({
  message,
  visible,
  onClose,
}: ReadReceiptsSheetProps) {
  const { t } = useTranslation("chat");
  const participants = useChatStore((s) =>
    message ? s.participantsByRoom[message.room_id] : undefined
  );

  const seen = useMemo(() => {
    if (!message) return [];
    return (participants ?? []).filter(
      (p) =>
        p.user_id !== message.sender_id && hasSeen(p, message.created_at)
    );
  }, [participants, message]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("receipts.title")}
        </Text>
      </View>

      {seen.length === 0 ? (
        <View className="items-center px-4 py-8">
          <Text className="font-sans text-caption text-fg-tertiary">
            {t("receipts.nobody")}
          </Text>
        </View>
      ) : (
        <ScrollView className="max-h-96">
          <View className="px-4 py-2">
            {seen.map((p) => {
              const name =
                p.profiles?.display_name || p.profiles?.username || "?";
              return (
                <View
                  key={p.user_id}
                  className="flex-row items-center gap-3 py-2"
                >
                  <Avatar
                    uri={p.profiles?.avatar_url}
                    name={name}
                    size={36}
                  />
                  <Text className="flex-1 font-sans text-body text-fg">
                    {name}
                  </Text>
                </View>
              );
            })}
          </View>
          <View className="h-3" />
        </ScrollView>
      )}
    </Sheet>
  );
}

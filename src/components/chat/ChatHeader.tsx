import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/src/components/ui/Avatar";

interface ChatHeaderProps {
  name: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
  participantCount?: number;
}

export function ChatHeader({
  name,
  avatarUrl,
  isOnline,
  participantCount,
}: ChatHeaderProps) {
  const { t } = useTranslation("chat");
  const router = useRouter();

  return (
    <View className="flex-row items-center gap-3 border-b border-gray-100 bg-white px-4 pb-3 pt-2">
      <Pressable
        onPress={() => router.back()}
        className="mr-1 active:opacity-50"
      >
        <SymbolView
          name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
          tintColor="#374151"
          size={22}
        />
      </Pressable>

      <Avatar uri={avatarUrl} name={name} size={36} />

      <View className="flex-1">
        <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-xs text-gray-400">
          {isOnline
            ? t("header.online")
            : participantCount
              ? t("header.members", { count: participantCount })
              : t("header.offline")}
        </Text>
      </View>
    </View>
  );
}

import { memo } from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { formatChatDayLabel } from "@/src/lib/formatDate";
import { useThemeColors } from "@/src/theme";

interface DateSeparatorProps {
  dateStr: string;
}

function DateSeparatorBase({ dateStr }: DateSeparatorProps) {
  const { t, i18n } = useTranslation("chat");
  const colors = useThemeColors();
  const label = formatChatDayLabel(dateStr, i18n.language, t);

  return (
    <View className="items-center py-2">
      <View
        className="rounded-full px-3 py-1"
        style={{ backgroundColor: colors.surfaceSecondary }}
      >
        <Text className="font-sans-medium text-caption text-fg-secondary">
          {label}
        </Text>
      </View>
    </View>
  );
}

export const DateSeparator = memo(DateSeparatorBase);

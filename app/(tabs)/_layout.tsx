import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { useThemeColors } from "@/src/theme";

export default function TabLayout() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.fgTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
        },
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerShadowVisible: false,
        headerTitleStyle: {
          fontFamily: "Inter_600SemiBold",
          fontSize: 17,
          color: colors.fg,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.messages"),
          tabBarIcon: ({ color }) => (
            <Icon
              name={{ ios: "bubble.left.and.bubble.right", android: "chat", web: "chat" }}
              color={color}
              size="lg"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: t("tabs.contacts"),
          tabBarIcon: ({ color }) => (
            <Icon
              name={{ ios: "person.2", android: "group", web: "group" }}
              color={color}
              size="lg"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color }) => (
            <Icon
              name={{ ios: "gearshape", android: "settings", web: "settings" }}
              color={color}
              size="lg"
            />
          ),
        }}
      />
    </Tabs>
  );
}

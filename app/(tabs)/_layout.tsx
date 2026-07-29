import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/src/components/ui/Icon";
import { FloatingTabBar } from "@/src/components/ui/TabBar";
import { useRoomStore } from "@/src/stores/roomStore";
import { useThemeColors } from "@/src/theme";

export default function TabLayout() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  // Total unread across rooms feeds the Messages tab badge
  const unreadTotal = useRoomStore((s) =>
    s.rooms.reduce((sum, room) => sum + (room.unread_count || 0), 0)
  );

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerShadowVisible: false,
        // Large left-aligned titles for a calmer, more premium header
        headerTitleAlign: "left",
        headerTitleStyle: {
          fontFamily: "Inter_700Bold",
          fontSize: 24,
          letterSpacing: -0.12,
          color: colors.fg,
        },
        headerTitleContainerStyle: {
          paddingLeft: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.messages"),
          tabBarBadge:
            unreadTotal > 0
              ? unreadTotal > 99
                ? "99+"
                : unreadTotal
              : undefined,
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

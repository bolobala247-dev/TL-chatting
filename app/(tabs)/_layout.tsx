import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";

export default function TabLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarStyle: {
          borderTopWidth: 1,
          borderTopColor: "#F1F5F9",
        },
        headerStyle: {
          backgroundColor: "#FFFFFF",
        },
        headerShadowVisible: false,
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 18,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.messages"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "bubble.left.and.bubble.right", android: "chat", web: "chat" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: t("tabs.contacts"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "person.2", android: "group", web: "group" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "gearshape", android: "settings", web: "settings" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}

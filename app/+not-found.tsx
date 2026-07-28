import { View, Text } from "react-native";
import { Link, Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function NotFoundScreen() {
  const { t } = useTranslation("errors");
  return (
    <>
      <Stack.Screen options={{ title: t("notFound.title") }} />
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text className="font-sans-bold text-headline text-fg">404</Text>
        <Text className="mt-2 font-sans text-body text-fg-tertiary">
          {t("notFound.message")}
        </Text>
        <Link href="/" className="mt-6">
          <Text className="font-sans-semibold text-body text-ink">
            {t("notFound.goHome")}
          </Text>
        </Link>
      </View>
    </>
  );
}

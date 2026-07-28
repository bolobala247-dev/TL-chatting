import { View, Text } from "react-native";
import { Link, Stack } from "expo-router";
import { useTranslation } from "react-i18next";

export default function NotFoundScreen() {
  const { t } = useTranslation("errors");
  return (
    <>
      <Stack.Screen options={{ title: t("notFound.title") }} />
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-2xl font-bold text-gray-900">404</Text>
        <Text className="mt-2 text-base text-gray-500">
          {t("notFound.message")}
        </Text>
        <Link href="/" className="mt-6">
          <Text className="text-base font-semibold text-primary-600">
            {t("notFound.goHome")}
          </Text>
        </Link>
      </View>
    </>
  );
}

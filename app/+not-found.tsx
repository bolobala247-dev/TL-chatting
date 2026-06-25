import { View, Text } from "react-native";
import { Link, Stack } from "expo-router";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Không tìm thấy" }} />
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-2xl font-bold text-gray-900">404</Text>
        <Text className="mt-2 text-base text-gray-500">
          Trang này không tồn tại
        </Text>
        <Link href="/" className="mt-6">
          <Text className="text-base font-semibold text-primary-600">
            Quay về trang chủ
          </Text>
        </Link>
      </View>
    </>
  );
}

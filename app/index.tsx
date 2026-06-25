import { Redirect } from "expo-router";
import { useAuthStore } from "@/src/stores/authStore";
import { LoadingSpinner } from "@/src/components/ui/LoadingSpinner";

export default function Index() {
  const { session, initialized } = useAuthStore();

  if (!initialized) {
    return <LoadingSpinner fullScreen />;
  }

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}

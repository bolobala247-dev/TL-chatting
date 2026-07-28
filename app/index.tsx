import { Redirect } from "expo-router";
import { useAuthStore } from "@/src/stores/authStore";
import { Spinner } from "@/src/components/ui/LoadingSpinner";

export default function Index() {
  const { session, initialized } = useAuthStore();

  if (!initialized) {
    return <Spinner fullScreen />;
  }

  if (session) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}

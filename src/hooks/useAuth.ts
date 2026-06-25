import { useEffect } from "react";
import { useAuthStore } from "@/src/stores/authStore";

export function useAuth() {
  const { initialize, initialized } = useAuthStore();

  useEffect(() => {
    if (!initialized) {
      initialize();
    }
  }, [initialized, initialize]);

  return useAuthStore();
}

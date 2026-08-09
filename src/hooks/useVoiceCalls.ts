import { useEffect } from "react";
import { supabase } from "@/src/lib/supabase";
import { profileService } from "@/src/services/profileService";
import { useAuthStore } from "@/src/stores/authStore";
import { useVoiceCallStore } from "@/src/stores/voiceCallStore";
import { VOICE_CALL_SUPPORTED } from "@/src/lib/voiceCall";
import type { Call } from "@/src/types";

export function useVoiceCalls() {
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (!userId || !VOICE_CALL_SUPPORTED) return;

    let disposed = false;
    const channel = supabase
      .channel("voice-calls:global")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls" },
        (payload) => {
          const call = payload.new as Call;
          if (call.callee_id !== userId || call.status !== "ringing") return;

          void profileService.getProfile(call.caller_id).then((profile) => {
            if (disposed) return;
            useVoiceCallStore.getState().handleIncoming(call, {
              id: call.caller_id,
              name: profile?.display_name || profile?.username || "",
              avatar: profile?.avatar_url ?? null,
            });
          }).catch(() => {});
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          useVoiceCallStore.getState().handleCallUpdate(payload.new as Call);
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}

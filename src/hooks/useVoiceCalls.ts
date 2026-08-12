import { useEffect } from "react";
import { supabase } from "@/src/lib/supabase";
import { profileService } from "@/src/services/profileService";
import { voiceCallService } from "@/src/services/voiceCallService";
import { useAuthStore } from "@/src/stores/authStore";
import { useVoiceCallStore } from "@/src/stores/voiceCallStore";
import { VOICE_CALL_SUPPORTED } from "@/src/lib/voiceCall";
import type { Call } from "@/src/types";

async function presentIncoming(call: Call, userId: string, disposed: () => boolean) {
  if (call.callee_id !== userId || call.status !== "ringing") return;
  const profile = await profileService.getProfile(call.caller_id);
  if (disposed()) return;
  useVoiceCallStore.getState().handleIncoming(call, {
    id: call.caller_id,
    name: profile?.display_name || profile?.username || "",
    avatar: profile?.avatar_url ?? null,
  });
}

export function useVoiceCalls() {
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (!userId || !VOICE_CALL_SUPPORTED) return;

    let disposed = false;
    const isDisposed = () => disposed;
    const reconcile = async () => {
      try {
        const call = await voiceCallService.getCurrentIncomingCall(userId);
        if (call) await presentIncoming(call, userId, isDisposed);
      } catch {
        // Realtime remains the primary path; a transient reconciliation error
        // should not prevent the global listener from subscribing.
      }
    };

    void voiceCallService.prepareRealtimeAuth().catch(() => {});
    void reconcile();

    const channel = supabase
      .channel("voice-calls:global")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls" },
        (payload) => {
          void presentIncoming(payload.new as Call, userId, isDisposed).catch(() => {});
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          useVoiceCallStore.getState().handleCallUpdate(payload.new as Call);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reconcile();
      });

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}

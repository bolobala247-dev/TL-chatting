import { useEffect } from "react";
import { AppState } from "react-native";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/stores/authStore";
import { useCallStore } from "@/src/stores/callStore";
import { WEBRTC_SUPPORTED } from "@/src/lib/webrtc";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Call } from "@/src/types";

const RESUBSCRIBE_DELAY_MS = 3000;

// Resolve the caller's public identity for the incoming-call UI
async function resolveCaller(callerId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url")
    .eq("id", callerId)
    .maybeSingle();

  return {
    id: callerId,
    name: data?.display_name || data?.username || "",
    avatar: data?.avatar_url ?? null,
  };
}

/**
 * Root-mounted listener for the signed-in user's calls. RLS scopes the
 * stream to rows where the user is caller or callee, so no filter is needed.
 * INSERTs raise the incoming-call UI; UPDATEs drive lifecycle on both sides.
 */
export function useCalls() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId || !WEBRTC_SUPPORTED) return;

    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (disposed) return;
        if (channel) supabase.removeChannel(channel);
        connect();
      }, RESUBSCRIBE_DELAY_MS);
    };

    const connect = () => {
      if (disposed) return;

      channel = supabase
        .channel("calls:global")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "calls" },
          (payload) => {
            const call = payload.new as Call;
            if (call.callee_id !== userId || call.status !== "ringing") return;
            resolveCaller(call.caller_id)
              .then((peer) => {
                if (!disposed) useCallStore.getState().handleIncomingRow(call, peer);
              })
              .catch(() => {});
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "calls" },
          (payload) => {
            useCallStore.getState().handleRowUpdate(payload.new as Call);
          }
        )
        .subscribe((status) => {
          if (disposed) return;
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            scheduleReconnect();
          }
        });
    };

    connect();

    const appStateSub = AppState.addEventListener("change", (state) => {
      if (disposed || state !== "active") return;
      if (channel?.state !== "joined") scheduleReconnect();
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      appStateSub.remove();
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);
}

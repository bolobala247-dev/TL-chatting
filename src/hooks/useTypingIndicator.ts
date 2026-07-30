import { useEffect, useRef, useState, useCallback } from "react";
import i18n from "@/src/i18n";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/stores/authStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { TYPING_DEBOUNCE_MS, TYPING_TIMEOUT_MS } from "@/src/lib/constants";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface TypingUser {
  user_id: string;
  display_name: string;
}

export function useTypingIndicator(roomId: string) {
  const userId = useAuthStore((s) => s.user?.id);
  const profile = useAuthStore((s) => s.profile);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingRef = useRef(0);
  const isTrackedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!userId || !roomId) return;

    const channel = supabase.channel(`typing:${roomId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users: TypingUser[] = [];

        for (const [presenceUserId, presences] of Object.entries(state)) {
          if (presenceUserId === userId) continue;
          const latest = presences[presences.length - 1] as any;
          if (latest?.typing) {
            users.push({
              user_id: presenceUserId,
              display_name: latest.display_name || i18n.t("someone"),
            });
          }
        }

        // Keep the array identity stable when nothing visible changed —
        // syncs also fire for our own track/untrack echoes and would
        // otherwise re-render the chat screen on every keystroke burst
        setTypingUsers((prev) => {
          if (
            prev.length === users.length &&
            prev.every(
              (p, i) =>
                p.user_id === users[i].user_id &&
                p.display_name === users[i].display_name
            )
          ) {
            return prev;
          }
          return users;
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      clearTimeout(timeoutRef.current);
      isTrackedRef.current = false;
      lastTypingRef.current = 0;
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, userId]);

  const startTyping = useCallback(() => {
    // Privacy: user opted out of broadcasting typing activity. Channel
    // presence bypasses RLS, so the gate lives on the sender's device.
    const settings = usePrivacyStore.getState().settings;
    if (settings && !settings.typing_indicators_enabled) return;

    const now = Date.now();
    if (now - lastTypingRef.current < TYPING_DEBOUNCE_MS) return;
    lastTypingRef.current = now;

    // track() only on the off→on edge: presence state is unchanged while
    // typing continues, so re-tracking would just fan out redundant syncs
    // to every member. The timeout below keeps the "on" state alive.
    if (!isTrackedRef.current) {
      isTrackedRef.current = true;
      channelRef.current?.track({
        typing: true,
        display_name: profile?.display_name || profile?.username || i18n.t("user"),
      });
    }

    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      isTrackedRef.current = false;
      channelRef.current?.untrack();
    }, TYPING_TIMEOUT_MS);
  }, [profile]);

  const stopTyping = useCallback(() => {
    clearTimeout(timeoutRef.current);
    if (isTrackedRef.current) {
      isTrackedRef.current = false;
      lastTypingRef.current = 0;
      channelRef.current?.untrack();
    }
  }, []);

  return { typingUsers, startTyping, stopTyping };
}

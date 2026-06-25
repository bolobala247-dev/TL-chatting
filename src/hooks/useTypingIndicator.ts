import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/src/lib/supabase";
import { useAuthStore } from "@/src/stores/authStore";
import { TYPING_DEBOUNCE_MS, TYPING_TIMEOUT_MS } from "@/src/lib/constants";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface TypingUser {
  user_id: string;
  display_name: string;
}

export function useTypingIndicator(roomId: string) {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!user || !roomId) return;

    const channel = supabase.channel(`typing:${roomId}`, {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users: TypingUser[] = [];

        for (const [userId, presences] of Object.entries(state)) {
          if (userId === user.id) continue;
          const latest = presences[presences.length - 1] as any;
          if (latest?.typing) {
            users.push({
              user_id: userId,
              display_name: latest.display_name || "Someone",
            });
          }
        }

        setTypingUsers(users);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      clearTimeout(timeoutRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, user]);

  const startTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingRef.current < TYPING_DEBOUNCE_MS) return;
    lastTypingRef.current = now;

    channelRef.current?.track({
      typing: true,
      display_name: profile?.display_name || profile?.username || "User",
    });

    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      channelRef.current?.untrack();
    }, TYPING_TIMEOUT_MS);
  }, [profile]);

  const stopTyping = useCallback(() => {
    clearTimeout(timeoutRef.current);
    channelRef.current?.untrack();
  }, []);

  return { typingUsers, startTyping, stopTyping };
}

import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/src/stores/authStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { privacyService } from "@/src/services/privacyService";
import {
  PRESENCE_HEARTBEAT_MS,
  PEER_PRESENCE_POLL_MS,
} from "@/src/lib/constants";
import type { PeerProfile } from "@/src/types";

// Own presence heartbeat, mounted once at the root while signed in.
// Writes only the caller's user_presence row (owner-only RLS); peers can
// only see the derived online flag through get_peer_profile, which applies
// the owner's online_visibility setting server-side.
// Also bootstraps privacy settings into the store so typing/receipt gating
// has them available before the settings screen is ever opened.
export function usePresenceHeartbeat(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!enabled || !userId) return;

    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const beat = () => {
      privacyService
        .heartbeat(userId)
        .catch((err) => console.error("[usePresenceHeartbeat]", err));
    };

    const start = () => {
      if (!active || interval) return;
      beat();
      interval = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    };

    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    usePrivacyStore.getState().fetchSettings(userId);
    start();

    // Pause the heartbeat in background so "online" reflects real activity
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });

    return () => {
      active = false;
      stop();
      sub.remove();
    };
  }, [enabled, userId]);
}

// Privacy-gated peer status for a direct chat: polls get_peer_profile while
// the screen is mounted. Returns null until loaded (header falls back to
// its member-count/offline copy).
export function usePeerPresence(peerId: string | null | undefined) {
  const [peer, setPeer] = useState<PeerProfile | null>(null);
  // Bumped by refresh() so block/unblock reflect immediately, not on next poll
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!peerId) {
      setPeer(null);
      return;
    }

    let cancelled = false;

    const fetchPeer = () => {
      privacyService
        .getPeerProfile(peerId)
        .then((data) => {
          if (!cancelled) setPeer(data);
        })
        .catch((err) => console.error("[usePeerPresence]", err));
    };

    fetchPeer();
    const interval = setInterval(fetchPeer, PEER_PRESENCE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [peerId, refreshKey]);

  return { peer, refresh };
}

import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { FEATURE_PUSH_PRESENCE, PRESENCE_AWAY_MS } from "@/src/lib/constants";
import { usePresenceStore, type PresenceMeta } from "@/src/stores/presenceStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { useAuthStore } from "@/src/stores/authStore";
import { privacyService } from "@/src/services/privacyService";
import { diag } from "@/src/lib/diagnostics";

/**
 * Push-based presence manager (Phase 10 §6/§7). Rides the EXISTING
 * `room:${roomId}` Realtime channel (no new channel): each participant
 * `channel.track`s a compact meta on subscribe; peers receive presence
 * sync/join/leave and the `presenceStore` becomes the live read model. The
 * durable `user_presence` row is written only on state transitions (join/away/
 * leave/background), not on a timer, so DB write volume drops sharply.
 *
 * Flag-off (FEATURE_PUSH_PRESENCE=false) ⇒ every method is a no-op and the
 * legacy 45s heartbeat + 30s peer poll (usePresence) run exactly as today.
 * Source-side privacy: a user who hid presence never tracks (§6.9).
 */

// Stable per-app-session id so multiple devices of the same user collapse to
// one online status (§6.10). Fresh per launch — sufficient for de-dup.
const DEVICE_ID = Crypto.randomUUID();

type LocalState = "Offline" | "Online" | "Away" | "Background";

let active: { channel: RealtimeChannel; roomId: string; userId: string } | null =
  null;
let localState: LocalState = "Offline";
let awayTimer: ReturnType<typeof setTimeout> | undefined;
let appStateBound = false;

// Source-side privacy gate (§6.9): a user who set online_visibility='nobody'
// broadcasts nothing, so peers never receive an "online" for them.
function canBroadcast(): boolean {
  return usePrivacyStore.getState().settings?.online_visibility !== "nobody";
}

// Flatten Realtime's Record<presenceKey, meta[]> into our meta list, keeping
// only well-formed metas (a hidden user simply isn't in here).
function readMetas(channel: RealtimeChannel): PresenceMeta[] {
  const raw = channel.presenceState<Partial<PresenceMeta>>();
  const metas: PresenceMeta[] = [];
  for (const key of Object.keys(raw)) {
    for (const m of raw[key]) {
      if (
        typeof m.user_id === "string" &&
        typeof m.device_id === "string" &&
        (m.state === "online" || m.state === "away") &&
        typeof m.last_active_at === "string"
      ) {
        metas.push({
          user_id: m.user_id,
          device_id: m.device_id,
          state: m.state,
          last_active_at: m.last_active_at,
        });
      }
    }
  }
  return metas;
}

function trackState(next: "online" | "away"): void {
  if (!active || !canBroadcast()) return;
  const meta: PresenceMeta = {
    user_id: active.userId,
    device_id: DEVICE_ID,
    state: next,
    last_active_at: new Date().toISOString(),
  };
  void active.channel.track(meta);
  diag.count("presence.track", 1, { state: next });
}

// Durable last-seen, written once on a transition out of a reachable state
// (§6.8). Reuses the existing owner-only upsert — no new query surface.
function writeLastSeen(): void {
  const userId = active?.userId ?? useAuthStore.getState().user?.id;
  if (!userId) return;
  void privacyService
    .heartbeat(userId)
    .catch((err) => console.error("[presenceService] last-seen", err));
}

function clearAwayTimer(): void {
  if (awayTimer) {
    clearTimeout(awayTimer);
    awayTimer = undefined;
  }
}

function startAwayTimer(): void {
  clearAwayTimer();
  awayTimer = setTimeout(() => {
    if (localState !== "Online") return;
    localState = "Away";
    trackState("away");
    writeLastSeen();
  }, PRESENCE_AWAY_MS);
}

function bindAppState(): void {
  if (appStateBound) return;
  appStateBound = true;
  AppState.addEventListener("change", (s) => {
    if (!FEATURE_PUSH_PRESENCE || !active) return;
    if (s === "active") {
      // Foreground: re-track online (the socket resubscribe re-fires sync).
      localState = "Online";
      trackState("online");
      startAwayTimer();
    } else {
      // Background: stop broadcasting and stamp a durable last-seen (§6.11).
      localState = "Background";
      clearAwayTimer();
      void active.channel.untrack();
      writeLastSeen();
    }
  });
}

export const presenceService = {
  /**
   * Register presence sync/join/leave handlers on the room channel builder
   * BEFORE `.subscribe()`. Returns the channel unchanged when the flag is off
   * (byte-identical). Multi-scope handlers all funnel a full-state replace.
   */
  bindRoomChannel(channel: RealtimeChannel, _roomId: string): RealtimeChannel {
    if (!FEATURE_PUSH_PRESENCE) return channel;
    const apply = () =>
      usePresenceStore.getState().setFromMetas(readMetas(channel));
    return channel
      .on("presence", { event: "sync" }, apply)
      .on("presence", { event: "join" }, apply)
      .on("presence", { event: "leave" }, apply);
  },

  /** On the channel's SUBSCRIBED status: begin broadcasting online (§6.3). */
  onSubscribed(channel: RealtimeChannel, roomId: string): void {
    if (!FEATURE_PUSH_PRESENCE) return;
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    active = { channel, roomId, userId };
    localState = "Online";
    bindAppState();
    trackState("online");
    startAwayTimer();
  },

  /** Reset the away timer on local interaction; re-track online if we were away. */
  noteActivity(): void {
    if (!FEATURE_PUSH_PRESENCE || !active) return;
    if (localState === "Away") {
      localState = "Online";
      trackState("online");
    }
    if (localState === "Online") startAwayTimer();
  },

  /** On chat-screen teardown: stamp last-seen and drop the live read model. */
  detach(roomId: string): void {
    if (!FEATURE_PUSH_PRESENCE) return;
    if (active && active.roomId !== roomId) return; // a newer room took over
    clearAwayTimer();
    writeLastSeen();
    usePresenceStore.getState().reset();
    active = null;
    localState = "Offline";
  },
};

import { create } from "zustand";

/**
 * Presence read model (Phase 10 §6/§7). A derived, in-memory projection of the
 * Realtime Presence metas received on the open room channel. It owns no network
 * and no durability — `presenceService` feeds it and the UI reads it. When a
 * user is absent from the live set the UI falls back to durable last-seen from
 * `get_peer_profile` (privacy-gated server-side), so this store only ever holds
 * the "online now / away now" signal.
 */

export type PresenceStatus = "online" | "away" | "offline";

// One tracked meta on a room presence channel. A user who hid presence tracks
// NOTHING (source-side privacy, §6.9), so they never appear here.
export interface PresenceMeta {
  user_id: string;
  device_id: string;
  state: "online" | "away";
  last_active_at: string;
}

interface PeerPresence {
  status: Exclude<PresenceStatus, "offline">;
  lastActiveAt: string | null;
}

interface PresenceState {
  byUser: Record<string, PeerPresence>;
  /**
   * Replace the derived set from a full presence sync (collapsing multi-device
   * by user: online if ANY meta is online, else away). Presence sync always
   * reflects the channel's full state, so a replace keeps the store consistent.
   */
  setFromMetas: (metas: PresenceMeta[]) => void;
  /** Read one user's live status (undefined ⇒ not present ⇒ use last-seen). */
  statusOf: (userId: string) => PresenceStatus;
  reset: () => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  byUser: {},

  setFromMetas: (metas) => {
    const byUser: Record<string, PeerPresence> = {};
    for (const m of metas) {
      const prev = byUser[m.user_id];
      // Multi-device collapse: any online wins; last-seen = max last_active_at.
      const status =
        prev?.status === "online" || m.state === "online" ? "online" : "away";
      const lastActiveAt =
        prev?.lastActiveAt && prev.lastActiveAt > m.last_active_at
          ? prev.lastActiveAt
          : m.last_active_at;
      byUser[m.user_id] = { status, lastActiveAt };
    }
    set({ byUser });
  },

  statusOf: (userId) => get().byUser[userId]?.status ?? "offline",

  reset: () => set({ byUser: {} }),
}));

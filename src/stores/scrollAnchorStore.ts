import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ANCHOR_MAX_ROOMS,
  ANCHOR_SCHEMA_VERSION,
  ANCHOR_TTL_MS,
} from "@/src/lib/constants";

// Phase 9 §1. One scroll anchor per room — the message the user was last
// reading, plus a fractional position within it. Anchor by message *id*
// (stable across relayout), never a pixel offset (invalidated by media loads /
// history prepends). `createdAt` is the room's monotonic ordering key, kept so
// restore can fall back to a nearest-by-time neighbor when the exact id is gone.
export interface ScrollAnchor {
  roomId: string;
  // The anchor message — a real server id, never a temp- optimistic id.
  messageId: string;
  // 0..1 — viewport-top position *within* the anchor item (0 = item top).
  offsetRatio: number;
  // The anchor message's created_at (ISO) — the time coordinate for fallback.
  createdAt: string;
  // Date.now() of the last write — drives staleness (TTL) + LRU pruning.
  updatedAt: number;
  // true ⇒ the user was pinned to the newest message ⇒ "no restore needed".
  atBottom: boolean;
}

interface AnchorState {
  anchors: Record<string, ScrollAnchor>;
  // Upsert one room's anchor (no-op when nothing meaningful changed).
  setAnchor: (anchor: ScrollAnchor) => void;
  // Drop a room's anchor (e.g. user returned to the bottom).
  clearAnchor: (roomId: string) => void;
  // Drop anchors beyond the TTL / over the LRU cap (called once on boot).
  pruneAnchors: () => void;
}

// Skip a durable write when the resting position hasn't meaningfully moved.
function isSameAnchor(prev: ScrollAnchor | undefined, next: ScrollAnchor): boolean {
  if (!prev) return false;
  return (
    prev.messageId === next.messageId &&
    prev.atBottom === next.atBottom &&
    Math.abs(prev.offsetRatio - next.offsetRatio) < 0.02
  );
}

// Phase 9 §1.3. An anchor may drive a restore only when it is fresh and points
// at a real, non-bottom position. Locatability is checked later, at restore
// time, against the actual window (the store can't know the resident rows).
export function isRestorable(anchor: ScrollAnchor | undefined): anchor is ScrollAnchor {
  if (!anchor) return false;
  if (anchor.atBottom) return false;
  if (!anchor.messageId) return false;
  if (!Number.isFinite(anchor.offsetRatio)) return false;
  return Date.now() - anchor.updatedAt <= ANCHOR_TTL_MS;
}

// Device-local scroll anchors: survive restarts, work fully offline, never
// synced (reading position is inherently per-device). Mirrors draftStore. This
// is disposable UI state — never a source of truth; losing it just means the
// room opens at the bottom. Wiped with everything else on logout.
export const useScrollAnchorStore = create<AnchorState>()(
  persist(
    (set, get) => ({
      anchors: {},

      setAnchor: (anchor) => {
        set((state) => {
          if (isSameAnchor(state.anchors[anchor.roomId], anchor)) return state;
          return {
            anchors: { ...state.anchors, [anchor.roomId]: anchor },
          };
        });
      },

      clearAnchor: (roomId) => {
        set((state) => {
          if (!state.anchors[roomId]) return state;
          const { [roomId]: _, ...rest } = state.anchors;
          return { anchors: rest };
        });
      },

      pruneAnchors: () => {
        const { anchors } = get();
        const now = Date.now();
        let entries = Object.values(anchors).filter(
          (a) => now - a.updatedAt <= ANCHOR_TTL_MS
        );
        if (entries.length > ANCHOR_MAX_ROOMS) {
          // Keep the most recently updated ANCHOR_MAX_ROOMS.
          entries = entries
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, ANCHOR_MAX_ROOMS);
        }
        if (entries.length === Object.keys(anchors).length) return;
        const next: Record<string, ScrollAnchor> = {};
        for (const a of entries) next[a.roomId] = a;
        set({ anchors: next });
      },
    }),
    {
      name: "talo-scroll-anchors",
      storage: createJSONStorage(() => AsyncStorage),
      version: ANCHOR_SCHEMA_VERSION,
      // Anchors are disposable — never worth migrating. Any unknown version
      // (schema change / corrupt blob) starts fresh at the bottom (§10).
      migrate: () => ({ anchors: {} }),
    }
  )
);

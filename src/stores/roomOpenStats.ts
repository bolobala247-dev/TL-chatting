import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ROOM_OPEN_STATS_MAX,
  ROOM_OPEN_STATS_SCHEMA_VERSION,
} from "@/src/lib/constants";

interface OpenStat {
  count: number;
  lastOpenedAt: number;
}

interface RoomOpenStatsState {
  stats: Record<string, OpenStat>;
  /** Increment a room's open counter (called on chat-screen mount). */
  recordOpen: (roomId: string) => void;
  /** The `n` most-frequently opened room ids (count desc, recency tiebreak). */
  topRoomIds: (n: number) => string[];
}

// LRU-cap the map by lastOpenedAt so the persisted blob can never grow
// unbounded (Phase 10 §2.3). Device-local, never synced, disposable.
function capStats(stats: Record<string, OpenStat>): Record<string, OpenStat> {
  const entries = Object.entries(stats);
  if (entries.length <= ROOM_OPEN_STATS_MAX) return stats;
  entries.sort((a, b) => b[1].lastOpenedAt - a[1].lastOpenedAt);
  return Object.fromEntries(entries.slice(0, ROOM_OPEN_STATS_MAX));
}

/**
 * A tiny device-local open-frequency model (Phase 10 §2.3): augments pure
 * recency (room-list order) so the prefetch warm set can include a couple of
 * frequently-opened-but-not-recent rooms. No server, no ML, disposable.
 */
export const useRoomOpenStats = create<RoomOpenStatsState>()(
  persist(
    (set, get) => ({
      stats: {},

      recordOpen: (roomId) => {
        set((state) => {
          const prev = state.stats[roomId];
          const next: Record<string, OpenStat> = {
            ...state.stats,
            [roomId]: {
              count: (prev?.count ?? 0) + 1,
              lastOpenedAt: Date.now(),
            },
          };
          return { stats: capStats(next) };
        });
      },

      topRoomIds: (n) => {
        return Object.entries(get().stats)
          .sort((a, b) => {
            if (b[1].count !== a[1].count) return b[1].count - a[1].count;
            return b[1].lastOpenedAt - a[1].lastOpenedAt;
          })
          .slice(0, n)
          .map(([roomId]) => roomId);
      },
    }),
    {
      name: "talo-room-open-stats",
      storage: createJSONStorage(() => AsyncStorage),
      // A schema bump discards the stats (they are pure optimization).
      version: ROOM_OPEN_STATS_SCHEMA_VERSION,
      migrate: () => ({ stats: {} }),
    }
  )
);

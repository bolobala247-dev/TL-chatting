import { create } from "zustand";
import { JUMP_STACK_MAX } from "@/src/lib/constants";

// Phase 11 §8. Where the viewport was the instant before a jump — pushed so the
// return chip can undo it. "bottom" means the user was pinned to the newest
// message (no anchor needed, just scrollToEnd on return).
export type JumpReturnAnchor =
  | { messageId: string; createdAt: string }
  | "bottom";

export interface JumpHistoryEntry {
  anchor: JumpReturnAnchor;
}

// The message currently washed by the one-shot highlight. The token lets the
// SAME message re-pulse on a repeat jump: a fresh token re-triggers the effect
// even though messageId is unchanged (§7).
interface HighlightState {
  messageId: string;
  token: number;
}

interface JumpState {
  // Per-room return trail (temporary, distinct from the durable Phase 9 anchor).
  historyByRoom: Record<string, JumpHistoryEntry[]>;
  // Per-room active highlight target.
  highlightByRoom: Record<string, HighlightState>;

  pushHistory: (roomId: string, anchor: JumpReturnAnchor) => void;
  popHistory: (roomId: string) => JumpHistoryEntry | undefined;
  setHighlight: (roomId: string, messageId: string) => void;
  clearHighlight: (roomId: string) => void;
  clearRoom: (roomId: string) => void;
  reset: () => void;
}

// Monotonic highlight token — module-scoped so a repeat jump to the same message
// always yields a new value.
let highlightToken = 0;

// RAM-only (never persisted, §8 / D-J7): a jump trail across an app restart is
// confusing and unbounded, so it lives only for the session and is wiped on
// logout via reset() alongside the other per-account stores.
export const useJumpStore = create<JumpState>((set, get) => ({
  historyByRoom: {},
  highlightByRoom: {},

  pushHistory: (roomId, anchor) => {
    set((state) => {
      const prev = state.historyByRoom[roomId] ?? [];
      // Bounded stack: drop the oldest entries beyond JUMP_STACK_MAX (§8).
      const next = [...prev, { anchor }].slice(-JUMP_STACK_MAX);
      return { historyByRoom: { ...state.historyByRoom, [roomId]: next } };
    });
  },

  popHistory: (roomId) => {
    const stack = get().historyByRoom[roomId] ?? [];
    if (stack.length === 0) return undefined;
    const top = stack[stack.length - 1];
    set((state) => ({
      historyByRoom: {
        ...state.historyByRoom,
        [roomId]: stack.slice(0, -1),
      },
    }));
    return top;
  },

  setHighlight: (roomId, messageId) => {
    highlightToken += 1;
    set((state) => ({
      highlightByRoom: {
        ...state.highlightByRoom,
        [roomId]: { messageId, token: highlightToken },
      },
    }));
  },

  clearHighlight: (roomId) => {
    set((state) => {
      if (!state.highlightByRoom[roomId]) return state;
      const { [roomId]: _removed, ...rest } = state.highlightByRoom;
      return { highlightByRoom: rest };
    });
  },

  clearRoom: (roomId) => {
    set((state) => {
      const hasHistory = roomId in state.historyByRoom;
      const hasHighlight = roomId in state.highlightByRoom;
      if (!hasHistory && !hasHighlight) return state;
      const historyByRoom = { ...state.historyByRoom };
      const highlightByRoom = { ...state.highlightByRoom };
      delete historyByRoom[roomId];
      delete highlightByRoom[roomId];
      return { historyByRoom, highlightByRoom };
    });
  },

  reset: () => set({ historyByRoom: {}, highlightByRoom: {} }),
}));

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface DraftEntry {
  text: string;
  updatedAt: number;
}

interface DraftState {
  drafts: Record<string, DraftEntry>;

  setDraft: (roomId: string, text: string) => void;
  clearDraft: (roomId: string) => void;
}

// Device-local drafts: survive restarts, work fully offline, never synced
export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},

      setDraft: (roomId, text) => {
        set((state) => {
          if (!text.trim()) {
            if (!state.drafts[roomId]) return state;
            const { [roomId]: _, ...rest } = state.drafts;
            return { drafts: rest };
          }
          return {
            drafts: {
              ...state.drafts,
              [roomId]: { text, updatedAt: Date.now() },
            },
          };
        });
      },

      clearDraft: (roomId) => {
        set((state) => {
          if (!state.drafts[roomId]) return state;
          const { [roomId]: _, ...rest } = state.drafts;
          return { drafts: rest };
        });
      },
    }),
    {
      name: "talo-drafts",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

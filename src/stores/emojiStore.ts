import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

const MAX_RECENT_EMOJIS = 24;

interface EmojiState {
  recentEmojis: string[];

  addRecentEmoji: (emoji: string) => void;
}

// Device-local "recently used" emojis for the picker — most recent first,
// deduped, capped. Never synced (same policy as drafts).
export const useEmojiStore = create<EmojiState>()(
  persist(
    (set) => ({
      recentEmojis: [],

      addRecentEmoji: (emoji) => {
        set((state) => ({
          recentEmojis: [
            emoji,
            ...state.recentEmojis.filter((e) => e !== emoji),
          ].slice(0, MAX_RECENT_EMOJIS),
        }));
      },
    }),
    {
      name: "talo-recent-emojis",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

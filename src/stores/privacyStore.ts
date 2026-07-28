import { create } from "zustand";
import { privacyService } from "@/src/services/privacyService";
import type {
  BlockedProfile,
  PrivacySettings,
  UpdateTables,
} from "@/src/types";

interface PrivacyState {
  settings: PrivacySettings | null;
  blocked: BlockedProfile[];
  loading: boolean;
  blockedLoading: boolean;

  fetchSettings: (userId: string) => Promise<void>;
  updateSettings: (
    userId: string,
    updates: UpdateTables<"privacy_settings">
  ) => Promise<void>;
  fetchBlocked: () => Promise<void>;
  blockUser: (blockerId: string, blockedId: string) => Promise<void>;
  unblockUser: (blockerId: string, blockedId: string) => Promise<void>;
  reset: () => void;
}

export const usePrivacyStore = create<PrivacyState>((set, get) => ({
  settings: null,
  blocked: [],
  loading: false,
  blockedLoading: false,

  fetchSettings: async (userId) => {
    set({ loading: true });
    try {
      const settings = await privacyService.getSettings(userId);
      set({ settings });
    } catch (error) {
      console.error("[PrivacyStore.fetchSettings]", error);
    } finally {
      set({ loading: false });
    }
  },

  updateSettings: async (userId, updates) => {
    const previous = get().settings;
    // Optimistic: settings screen toggles feel instant, revert on error
    if (previous) {
      set({ settings: { ...previous, ...updates } as PrivacySettings });
    }
    try {
      const settings = await privacyService.updateSettings(userId, updates);
      set({ settings });
    } catch (error) {
      console.error("[PrivacyStore.updateSettings]", error);
      set({ settings: previous });
      throw error;
    }
  },

  fetchBlocked: async () => {
    set({ blockedLoading: true });
    try {
      const blocked = await privacyService.getBlockedProfiles();
      set({ blocked });
    } catch (error) {
      console.error("[PrivacyStore.fetchBlocked]", error);
    } finally {
      set({ blockedLoading: false });
    }
  },

  blockUser: async (blockerId, blockedId) => {
    await privacyService.blockUser(blockerId, blockedId);
    await get().fetchBlocked();
  },

  unblockUser: async (blockerId, blockedId) => {
    const previous = get().blocked;
    set({ blocked: previous.filter((b) => b.id !== blockedId) });
    try {
      await privacyService.unblockUser(blockerId, blockedId);
    } catch (error) {
      console.error("[PrivacyStore.unblockUser]", error);
      set({ blocked: previous });
      throw error;
    }
  },

  reset: () =>
    set({ settings: null, blocked: [], loading: false, blockedLoading: false }),
}));

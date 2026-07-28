import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import i18n, {
  getStoredLanguage,
  isSupportedLanguage,
  setAppLanguage,
} from "@/src/i18n";
import { supabase } from "@/src/lib/supabase";
import { profileService } from "@/src/services/profileService";
import { pushTokenService } from "@/src/services/pushTokenService";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import type { Profile } from "@/src/types";

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  initialized: boolean;
  loading: boolean;

  setSession: (session: Session | null) => void;
  setProfile: (profile: Profile | null) => void;
  setInitialized: (initialized: boolean) => void;
  initialize: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  // Trả về true nếu có session ngay (auto-confirm email đang bật)
  signUp: (email: string, password: string, username: string) => Promise<boolean>;
  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  initialized: false,
  loading: false,

  setSession: (session) =>
    set({ session, user: session?.user ?? null }),

  setProfile: (profile) => set({ profile }),

  setInitialized: (initialized) => set({ initialized }),

  initialize: async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      set({ session, user: session?.user ?? null });

      if (session?.user) {
        await get().fetchProfile();
      }

      // Push registration is handled by useNotifications/startPushTokenSync.
      // Never await Supabase calls inside this callback (deadlock risk).
      supabase.auth.onAuthStateChange((event, session) => {
        set({ session, user: session?.user ?? null });
        if (session?.user) {
          setTimeout(() => {
            void get().fetchProfile();
          }, 0);
        } else {
          set({ profile: null });
        }
      });
    } finally {
      set({ initialized: true });
    }
  },

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;

    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (data) {
      set({ profile: data });

      // An explicit choice on this device (e.g. the login-screen toggle)
      // wins over the profile and is synced up to it; the profile language
      // only applies when this device has no local choice yet.
      const localChoice = await getStoredLanguage();
      if (localChoice) {
        if (data.preferred_language !== localChoice) {
          try {
            await profileService.updateProfile(user.id, {
              preferred_language: localChoice,
            });
            set({ profile: { ...data, preferred_language: localChoice } });
          } catch (error) {
            console.error("[AuthStore.fetchProfile] sync language", error);
          }
        }
      } else if (
        isSupportedLanguage(data.preferred_language) &&
        data.preferred_language !== i18n.language
      ) {
        void setAppLanguage(data.preferred_language);
      }
    }
  },

  signUp: async (email, password, username) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username, display_name: username },
        },
      });
      if (error) throw error;
      return !!data.session;
    } finally {
      set({ loading: false });
    }
  },

  signIn: async (identifier, password) => {
    set({ loading: true });
    try {
      // Cho phép đăng nhập bằng email hoặc username
      let email = identifier;
      if (!identifier.includes("@")) {
        const resolved = await profileService.getEmailByUsername(identifier);
        if (!resolved) {
          throw new Error(i18n.t("auth:errors.usernameNotFound"));
        }
        email = resolved;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    try {
      await pushTokenService.removeCurrentToken();
    } catch (error) {
      console.error("[AuthStore.signOut] remove push token", error);
    }

    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    // Clear per-account client state so the next user never sees stale data
    useChatStore.getState().reset();
    useRoomStore.getState().reset();
    set({ session: null, user: null, profile: null });
  },

  resetPassword: async (email) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: Linking.createURL("/(auth)/reset-password"),
      });
      if (error) throw error;
    } finally {
      set({ loading: false });
    }
  },

  updatePassword: async (newPassword) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;

      await supabase.auth.signOut();
      set({ session: null, user: null, profile: null });
    } finally {
      set({ loading: false });
    }
  },
}));

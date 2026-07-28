import { supabase } from "@/src/lib/supabase";
import type { Profile, ProfileSearchResult, UpdateTables } from "@/src/types";

export const profileService = {
  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data;
  },

  async updateProfile(
    userId: string,
    updates: UpdateTables<"profiles">
  ): Promise<Profile> {
    const { data, error } = await supabase
      .from("profiles")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getEmailByUsername(username: string): Promise<string | null> {
    const { data, error } = await supabase.rpc("get_email_by_username", {
      p_username: username,
    });

    if (error) throw error;
    return data ?? null;
  },

  async isUsernameTaken(username: string): Promise<boolean> {
    // SECURITY DEFINER RPC: works for anon (registration) without exposing profiles
    const { data, error } = await supabase.rpc("is_username_available", {
      p_username: username,
    });

    if (error) throw error;
    return data === false;
  },

  async searchUsers(
    query: string,
    _currentUserId: string
  ): Promise<ProfileSearchResult[]> {
    // SECURITY DEFINER RPC: excludes blocked users, masks avatar per privacy settings
    const { data, error } = await supabase.rpc("search_profiles", {
      p_query: query,
    });

    if (error) throw error;
    return (data ?? []) as ProfileSearchResult[];
  },

  async uploadAvatar(userId: string, uri: string): Promise<string> {
    const fileName = `${userId}/${Date.now()}.jpg`;
    // RN không hỗ trợ tạo Blob từ ArrayBuffer — upload ArrayBuffer trực tiếp
    const response = await fetch(uri);
    const arrayBuffer = await response.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(fileName);

    await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", userId);

    return publicUrl;
  },
};

import { supabase } from "@/src/lib/supabase";
import type { Profile, UpdateTables } from "@/src/types";

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

  async searchUsers(query: string, currentUserId: string): Promise<Profile[]> {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .neq("id", currentUserId)
      .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
      .limit(20);

    if (error) throw error;
    return data ?? [];
  },

  async uploadAvatar(userId: string, uri: string): Promise<string> {
    const fileName = `${userId}/${Date.now()}.jpg`;
    const response = await fetch(uri);
    const blob = await response.blob();

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, blob, {
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

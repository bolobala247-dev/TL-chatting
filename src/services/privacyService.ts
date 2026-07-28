import { supabase } from "@/src/lib/supabase";
import type {
  BlockedProfile,
  PeerProfile,
  PrivacySettings,
  ReportReason,
  UpdateTables,
} from "@/src/types";

export const privacyService = {
  // ============ Privacy settings (owner-only rows) ============

  async getSettings(userId: string): Promise<PrivacySettings | null> {
    const { data, error } = await supabase
      .from("privacy_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async updateSettings(
    userId: string,
    updates: UpdateTables<"privacy_settings">
  ): Promise<PrivacySettings> {
    const { data, error } = await supabase
      .from("privacy_settings")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // ============ Peer profile (privacy-gated via RPC) ============

  async getPeerProfile(userId: string): Promise<PeerProfile | null> {
    const { data, error } = await supabase.rpc("get_peer_profile", {
      p_user_id: userId,
    });

    if (error) throw error;
    return ((data ?? [])[0] as PeerProfile | undefined) ?? null;
  },

  // ============ Presence heartbeat (own row only) ============

  async heartbeat(userId: string): Promise<void> {
    const { error } = await supabase
      .from("user_presence")
      .upsert(
        { user_id: userId, last_active_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (error) throw error;
  },

  // ============ Blocking ============

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await supabase
      .from("user_blocks")
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true }
      );

    if (error) throw error;
  },

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    const { error } = await supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", blockerId)
      .eq("blocked_id", blockedId);

    if (error) throw error;
  },

  async getBlockedProfiles(): Promise<BlockedProfile[]> {
    const { data, error } = await supabase.rpc("get_blocked_profiles");

    if (error) throw error;
    return (data ?? []) as BlockedProfile[];
  },

  // ============ Reporting (RPC snapshots evidence server-side) ============

  async reportUser(
    reportedUserId: string,
    reason: ReportReason,
    options?: { messageId?: string; details?: string }
  ): Promise<string> {
    const { data, error } = await supabase.rpc("submit_report", {
      p_reported_user_id: reportedUserId,
      p_reason: reason,
      ...(options?.messageId ? { p_message_id: options.messageId } : {}),
      ...(options?.details ? { p_details: options.details } : {}),
    });

    if (error) throw error;
    return data as string;
  },
};

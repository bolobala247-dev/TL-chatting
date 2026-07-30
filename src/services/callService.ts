import { supabase } from "@/src/lib/supabase";
import type { Call, CallType, CallStatus, Profile } from "@/src/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

// Broadcast events carried on the per-call signaling channel. Media never
// flows here — only the SDP handshake, ICE trickle and hangup fan-out.
export type SignalEvent = "ready" | "offer" | "answer" | "ice" | "hangup";

// A call row joined with the peer's public identity, for the history list
export interface CallWithPeer extends Call {
  caller: Pick<Profile, "id" | "display_name" | "username" | "avatar_url"> | null;
  callee: Pick<Profile, "id" | "display_name" | "username" | "avatar_url"> | null;
}

const CALL_WITH_PEER_SELECT =
  "*, caller:profiles!calls_caller_id_fkey(id, display_name, username, avatar_url), callee:profiles!calls_callee_id_fkey(id, display_name, username, avatar_url)";

export const callService = {
  // Caller opens the call. RLS enforces 1:1 room membership + no active block.
  async createCall(
    roomId: string,
    callerId: string,
    calleeId: string,
    type: CallType
  ): Promise<Call> {
    const { data, error } = await supabase
      .from("calls")
      .insert({
        room_id: roomId,
        caller_id: callerId,
        callee_id: calleeId,
        type,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Move the call through its lifecycle. The DB trigger writes the call-log
  // message on the first transition into a terminal status.
  async updateStatus(
    callId: string,
    status: CallStatus,
    extra?: { answered_at?: string; ended_at?: string; duration_seconds?: number }
  ): Promise<Call | null> {
    const { data, error } = await supabase
      .from("calls")
      .update({ status, ...extra })
      .eq("id", callId)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async getCall(callId: string): Promise<Call | null> {
    const { data, error } = await supabase
      .from("calls")
      .select("*")
      .eq("id", callId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  // Call history (both directions), newest first — for the history list.
  async getCallHistory(userId: string, limit = 50): Promise<CallWithPeer[]> {
    const { data, error } = await supabase
      .from("calls")
      .select(CALL_WITH_PEER_SELECT)
      .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data ?? []) as unknown as CallWithPeer[];
  },

  // Per-call signaling channel. Broadcast (not postgres_changes) so SDP/ICE
  // never round-trips through the database. `self: false` avoids echo.
  createSignalChannel(callId: string, userId: string): RealtimeChannel {
    return supabase.channel(`call:${callId}`, {
      config: { broadcast: { self: false }, presence: { key: userId } },
    });
  },
};

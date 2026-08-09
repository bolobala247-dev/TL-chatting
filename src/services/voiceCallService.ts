import { supabase } from "@/src/lib/supabase";
import type { Call, InsertTables, UpdateTables, VoiceCallStatus } from "@/src/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type VoiceSignal =
  | { kind: "ready" }
  | { kind: "offer"; description: unknown }
  | { kind: "answer"; description: unknown }
  | { kind: "ice"; candidate: unknown }
  | { kind: "hangup" };

export const voiceCallService = {
  async createCall(roomId: string, callerId: string, calleeId: string): Promise<Call> {
    const insert: InsertTables<"calls"> = {
      room_id: roomId,
      caller_id: callerId,
      callee_id: calleeId,
      type: "audio",
    };
    const { data, error } = await supabase.from("calls").insert(insert).select().single();
    if (error) throw error;
    return data;
  },

  async updateStatus(callId: string, status: VoiceCallStatus): Promise<Call | null> {
    const updates: UpdateTables<"calls"> = { status };
    if (status === "answered") updates.answered_at = new Date().toISOString();
    if (["ended", "declined", "missed"].includes(status)) {
      updates.ended_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("calls")
      .update(updates)
      .eq("id", callId)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  createSignalChannel(callId: string): RealtimeChannel {
    return supabase.channel(`voice-call:${callId}`, {
      config: { broadcast: { self: false } },
    });
  },
};

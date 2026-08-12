import { supabase } from "@/src/lib/supabase";
import { getIceServers } from "@/src/lib/constants";
import type { Call, InsertTables, VoiceCallStatus } from "@/src/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type VoiceSignalKind =
  | "ready"
  | "offer"
  | "answer"
  | "ice"
  | "hangup"
  | "ack";

export type VoiceSignalEnvelope = {
  version: 1;
  callId: string;
  senderId: string;
  messageId: string;
  kind: VoiceSignalKind;
  payload?: unknown;
  ackFor?: string;
};

export type VoiceSignal =
  | { kind: "ready" }
  | { kind: "offer"; description: unknown }
  | { kind: "answer"; description: unknown }
  | { kind: "ice"; candidate: unknown }
  | { kind: "hangup" }
  | { kind: "ack"; ackFor: string };

export type VoiceCallAction = "answered" | "declined" | "missed" | "ended";

let turnCache: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;

function createMessageId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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

  async transitionCall(callId: string, status: VoiceCallAction): Promise<Call> {
    const { data, error } = await supabase.rpc("transition_voice_call", {
      p_call_id: callId,
      p_status: status,
    });
    if (error) throw error;
    return data;
  },

  // Kept for old callers during rollout; all new call code uses the guarded RPC.
  async updateStatus(callId: string, status: VoiceCallStatus): Promise<Call | null> {
    if (status === "ringing") return null;
    return this.transitionCall(callId, status);
  },

  async getCurrentIncomingCall(userId: string): Promise<Call | null> {
    const cutoff = new Date(Date.now() - 35_000).toISOString();
    const { data, error } = await supabase
      .from("calls")
      .select()
      .eq("callee_id", userId)
      .eq("status", "ringing")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async prepareRealtimeAuth(): Promise<void> {
    const { data } = await supabase.auth.getSession();
    await supabase.realtime.setAuth(data.session?.access_token ?? null);
  },

  createSignalChannel(callId: string): RealtimeChannel {
    const config = {
      config: {
        private: true,
        broadcast: { self: false, ack: true },
      },
    };
    return supabase.channel(`voice-call:${callId}`, config);
  },

  async sendSignal(channel: RealtimeChannel, envelope: VoiceSignalEnvelope): Promise<void> {
    const status = await channel.send({
      type: "broadcast",
      event: "signal",
      payload: envelope,
    });
    if (status !== "ok") throw new Error("signaling-unavailable");
  },

  createEnvelope(callId: string, senderId: string, signal: VoiceSignal): VoiceSignalEnvelope {
    const { kind, ...payload } = signal;
    return {
      version: 1,
      callId,
      senderId,
      messageId: createMessageId(),
      kind,
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
      ...(signal.kind === "ack" ? { ackFor: signal.ackFor } : {}),
    };
  },

  async getIceServers(): Promise<RTCIceServer[]> {
    if (turnCache && turnCache.expiresAt > Date.now() + 30_000) {
      return turnCache.iceServers;
    }

    const { data, error } = await supabase.functions.invoke<{
      iceServers?: RTCIceServer[];
      expiresAt?: string;
      code?: string;
    }>("get-turn-credentials", { body: {} });

    if (!error && data?.iceServers?.length) {
      const expiresAt = data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + 300_000;
      turnCache = { iceServers: data.iceServers, expiresAt };
      return data.iceServers;
    }

    return getIceServers() as RTCIceServer[];
  },
};

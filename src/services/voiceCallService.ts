import { supabase } from "@/src/lib/supabase";
import { getIceServers } from "@/src/lib/constants";
import { callDebug, callDebugWarn, shortCallId, summarizeCallError } from "@/src/lib/callDebug";
import type { Call, CallType, InsertTables, VoiceCallStatus } from "@/src/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type VoiceSignalKind =
  | "ready"
  | "offer"
  | "answer"
  | "ice"
  | "hangup"
  | "ack"
  | "media-state"
  | "ice-restart";

export type VoiceSignalEnvelope = {
  version: 1;
  callId: string;
  senderId: string;
  messageId: string;
  kind: VoiceSignalKind;
  payload?: unknown;
  ackFor?: string;
};

export type CallSignalKind = VoiceSignalKind;
export type CallSignalEnvelope = VoiceSignalEnvelope;

export type VoiceSignal =
  | { kind: "ready"; protocolVersion?: number; supportedCallTypes?: CallType[] }
  | { kind: "offer"; description: unknown }
  | { kind: "answer"; description: unknown }
  | { kind: "ice"; candidate: unknown }
  | { kind: "hangup" }
  | { kind: "media-state"; audioEnabled: boolean; videoEnabled: boolean; revision: number }
  | { kind: "ice-restart"; phase: "request" | "ready" }
  | { kind: "ack"; ackFor: string };

export type CallSignal = VoiceSignal;

export type VoiceCallAction = "answered" | "declined" | "missed" | "ended";

let turnCache: { callId: string | null; iceServers: RTCIceServer[]; expiresAt: number } | null = null;

function createMessageId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const voiceCallService = {
  async createCall(roomId: string, callerId: string, calleeId: string, type: CallType = "audio"): Promise<Call> {
    callDebug("create-call:start", { type, roomId: shortCallId(roomId) });
    const insert: InsertTables<"calls"> = {
      room_id: roomId,
      caller_id: callerId,
      callee_id: calleeId,
      type,
    };
    const { data, error } = await supabase.from("calls").insert(insert).select().single();
    if (error) {
      callDebugWarn("create-call:error", { type, ...summarizeCallError(error) });
      throw error;
    }
    callDebug("create-call:ok", { callId: shortCallId(data?.id), type });
    return data;
  },

  async transitionCall(callId: string, status: VoiceCallAction): Promise<Call> {
    const { data, error } = await supabase.rpc("transition_voice_call", {
      p_call_id: callId,
      p_status: status,
    });
    if (error) {
      callDebugWarn("transition:error", { callId: shortCallId(callId), status, ...summarizeCallError(error) });
      throw error;
    }
    callDebug("transition:ok", { callId: shortCallId(callId), status });
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
    callDebug("realtime-auth", { hasSession: Boolean(data.session?.access_token) });
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
    callDebug("signal:send", {
      callId: shortCallId(envelope.callId),
      kind: envelope.kind,
      messageId: shortCallId(envelope.messageId),
    });
    const status = await channel.send({
      type: "broadcast",
      event: "signal",
      payload: envelope,
    });
    if (status !== "ok") {
      callDebugWarn("signal:send-error", { callId: shortCallId(envelope.callId), kind: envelope.kind, status });
      throw new Error("signaling-unavailable");
    }
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

  async getIceServers(callId?: string, options?: { forceRefresh?: boolean }): Promise<RTCIceServer[]> {
    if (!options?.forceRefresh && turnCache && turnCache.callId === (callId ?? null) && turnCache.expiresAt > Date.now() + 30_000) {
      callDebug("turn:cache-hit", { callId: shortCallId(callId), count: turnCache.iceServers.length });
      return turnCache.iceServers;
    }

    callDebug("turn:request", { callId: shortCallId(callId), forceRefresh: Boolean(options?.forceRefresh) });
    const { data, error } = await supabase.functions.invoke<{
      iceServers?: RTCIceServer[];
      expiresAt?: string;
      code?: string;
      quota?: unknown;
    }>("get-turn-credentials", { body: callId ? { callId } : {} });

    if (!error && data?.iceServers?.length) {
      const expiresAt = data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + 300_000;
      turnCache = { callId: callId ?? null, iceServers: data.iceServers, expiresAt };
      callDebug("turn:ok", { callId: shortCallId(callId), count: data.iceServers.length, hasQuota: Boolean(data.quota) });
      return data.iceServers;
    }

    callDebugWarn("turn:fallback-stun", {
      callId: shortCallId(callId),
      code: data?.code,
      ...summarizeCallError(error),
    });
    return getIceServers() as RTCIceServer[];
  },
};

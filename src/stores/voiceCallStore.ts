import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  VOICE_CALL_SUPPORTED,
  type VoiceMediaStream,
} from "@/src/lib/voiceCall";
import { voiceCallAudio } from "@/src/lib/voiceCallAudio";
import {
  VOICE_CALL_CONNECT_TIMEOUT_MS,
  VOICE_CALL_RING_TIMEOUT_MS,
} from "@/src/lib/constants";
import {
  voiceCallService,
  type VoiceSignal,
  type VoiceSignalEnvelope,
} from "@/src/services/voiceCallService";
import { useAuthStore } from "@/src/stores/authStore";
import type { Call } from "@/src/types";

export type VoiceCallPhase = "idle" | "ringing" | "connecting" | "connected" | "ended";
export type CallFailureCode =
  | "permission-denied"
  | "microphone-unavailable"
  | "signaling-unavailable"
  | "relay-unavailable"
  | "connection-timeout"
  | "audio-playback-blocked"
  | "call-connect-failed";

interface PeerInfo {
  id: string;
  name: string;
  avatar: string | null;
}

interface VoiceCallState {
  callId: string | null;
  roomId: string | null;
  peer: PeerInfo | null;
  direction: "incoming" | "outgoing" | null;
  phase: VoiceCallPhase;
  micEnabled: boolean;
  speakerEnabled: boolean;
  connectedAt: number | null;
  error: CallFailureCode | null;
  audioPlaybackBlocked: boolean;
  startCall: (roomId: string, peer: PeerInfo) => Promise<void>;
  handleIncoming: (call: Call, peer: PeerInfo) => void;
  handleCallUpdate: (call: Call) => void;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  end: () => Promise<void>;
  retryCall: () => Promise<void>;
  resumeRemoteAudio: () => Promise<void>;
  dismissError: () => void;
  toggleMic: () => void;
  toggleSpeaker: () => void;
}

interface Session {
  pc: RTCPeerConnection | null;
  channel: RealtimeChannel | null;
  localStream: VoiceMediaStream | null;
  remoteDescriptionSet: boolean;
  pendingCandidates: unknown[];
  ringTimer?: ReturnType<typeof setTimeout>;
  connectTimer?: ReturnType<typeof setTimeout>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  callId: string | null;
  userId: string | null;
  peerId: string | null;
  stopping: boolean;
  reconnecting: boolean;
  receivedMessageIds: Set<string>;
  acknowledgedMessageIds: Set<string>;
  pendingReliable: Map<string, Promise<void>>;
  readySent: boolean;
  offerSent: boolean;
  answerSent: boolean;
  lastOfferMessageId: string | null;
  lastOfferDescription: unknown | null;
  lastAnswer: unknown | null;
}

const session: Session = {
  pc: null,
  channel: null,
  localStream: null,
  remoteDescriptionSet: false,
  pendingCandidates: [],
  callId: null,
  userId: null,
  peerId: null,
  stopping: false,
  reconnecting: false,
  receivedMessageIds: new Set(),
  acknowledgedMessageIds: new Set(),
  pendingReliable: new Map(),
  readySent: false,
  offerSent: false,
  answerSent: false,
  lastOfferMessageId: null,
  lastOfferDescription: null,
  lastAnswer: null,
};

const IDLE: Pick<
  VoiceCallState,
  | "callId"
  | "roomId"
  | "peer"
  | "direction"
  | "phase"
  | "micEnabled"
  | "speakerEnabled"
  | "connectedAt"
  | "error"
  | "audioPlaybackBlocked"
> = {
  callId: null,
  roomId: null,
  peer: null,
  direction: null,
  phase: "idle",
  micEnabled: true,
  speakerEnabled: false,
  connectedAt: null,
  error: null,
  audioPlaybackBlocked: false,
};

const FAILURE_CODES = new Set<CallFailureCode>([
  "permission-denied",
  "microphone-unavailable",
  "signaling-unavailable",
  "relay-unavailable",
  "connection-timeout",
  "audio-playback-blocked",
  "call-connect-failed",
]);

function errorCode(error: unknown): CallFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (FAILURE_CODES.has(message as CallFailureCode)) return message as CallFailureCode;
  if (/notallowed|permission|denied/i.test(message)) return "permission-denied";
  if (/notfound|microphone|media/i.test(message)) return "microphone-unavailable";
  return "call-connect-failed";
}

async function getMicrophone(): Promise<VoiceMediaStream> {
  if (!mediaDevices) throw new Error("microphone-unavailable");
  try {
    return (await mediaDevices.getUserMedia({ audio: true, video: false })) as VoiceMediaStream;
  } catch (error) {
    throw new Error(errorCode(error));
  }
}

function serializableDescription(description: any): unknown {
  return typeof description?.toJSON === "function"
    ? description.toJSON()
    : { type: description?.type, sdp: description?.sdp };
}

function serializableCandidate(candidate: any): unknown {
  return typeof candidate?.toJSON === "function" ? candidate.toJSON() : candidate;
}

function clearTimers() {
  clearTimeout(session.ringTimer);
  clearTimeout(session.connectTimer);
  clearTimeout(session.reconnectTimer);
  session.ringTimer = undefined;
  session.connectTimer = undefined;
  session.reconnectTimer = undefined;
}

function stopSession() {
  session.stopping = true;
  clearTimers();
  session.channel?.unsubscribe();
  session.channel = null;
  session.pc?.close();
  session.pc = null;
  session.localStream?.getTracks().forEach((track) => track.stop());
  session.localStream = null;
  session.remoteDescriptionSet = false;
  session.pendingCandidates = [];
  session.callId = null;
  session.userId = null;
  session.peerId = null;
  session.reconnecting = false;
  session.receivedMessageIds.clear();
  session.acknowledgedMessageIds.clear();
  session.pendingReliable.clear();
  session.readySent = false;
  session.offerSent = false;
  session.answerSent = false;
  session.lastOfferMessageId = null;
  session.lastOfferDescription = null;
  session.lastAnswer = null;
  voiceCallAudio.stopRingback();
  voiceCallAudio.stopRingtone();
  voiceCallAudio.stop();
}

async function flushCandidates() {
  if (!session.pc || !session.remoteDescriptionSet) return;
  const pending = session.pendingCandidates.splice(0);
  for (const candidate of pending) {
    try {
      await session.pc.addIceCandidate(new RTCIceCandidate(candidate as any));
    } catch {
      // A late candidate is harmless after a peer connection closes.
    }
  }
}

export const useVoiceCallStore = create<VoiceCallState>((set, get) => {
  async function sendEnvelope(envelope: VoiceSignalEnvelope): Promise<void> {
    if (!session.channel) throw new Error("signaling-unavailable");
    await voiceCallService.sendSignal(session.channel, envelope);
  }

  async function sendSignal(signal: VoiceSignal): Promise<VoiceSignalEnvelope> {
    const callId = session.callId;
    const userId = session.userId;
    if (!callId || !userId) throw new Error("signaling-unavailable");
    const envelope = voiceCallService.createEnvelope(callId, userId, signal);
    await sendEnvelope(envelope);
    return envelope;
  }

  async function sendReliable(signal: VoiceSignal, attempts = 5): Promise<void> {
    const envelope = await sendSignal(signal);
    if (signal.kind === "ice" || signal.kind === "hangup") return;

    const task = (async () => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (session.acknowledgedMessageIds.has(envelope.messageId)) return;
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
        if (!session.channel || session.stopping) return;
        try {
          await sendEnvelope(envelope);
        } catch {
          // Reconnect handling will retry the same logical message.
        }
      }
    })();
    session.pendingReliable.set(envelope.messageId, task);
    await task.finally(() => session.pendingReliable.delete(envelope.messageId));
  }

  async function sendAck(messageId: string) {
    try {
      await sendSignal({ kind: "ack", ackFor: messageId });
    } catch {
      // The sender's retry loop will handle transient channel loss.
    }
  }

  async function ensureCallerOffer(force = false) {
    if (get().direction !== "outgoing" || !session.channel) return;
    if (!session.pc) {
      const local = await getMicrophone();
      await createPeerConnection(local);
    }
    if (!session.pc) return;
    if (session.offerSent && !force) return;
    if (session.offerSent && session.lastOfferDescription) {
      await sendReliable({ kind: "offer", description: session.lastOfferDescription }, 3);
      return;
    }
    const offer = await session.pc.createOffer();
    await session.pc.setLocalDescription(offer);
    session.lastOfferDescription = serializableDescription(offer);
    session.offerSent = true;
    await sendReliable({ kind: "offer", description: session.lastOfferDescription });
  }

  async function createPeerConnection(localStream: VoiceMediaStream) {
    const pc = new RTCPeerConnection({
      iceServers: await voiceCallService.getIceServers(),
    });
    session.pc = pc;
    session.localStream = localStream;
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    (pc as any).ontrack = (event: any) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      voiceCallAudio.start();
      void voiceCallAudio.attachRemoteAudio(stream).then((playing) => {
        if (!playing) set({ audioPlaybackBlocked: true, error: "audio-playback-blocked" });
      });
    };
    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) void sendSignal({ kind: "ice", candidate: serializableCandidate(event.candidate) });
    };
    (pc as any).onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearTimeout(session.connectTimer);
        clearTimeout(session.ringTimer);
        session.ringTimer = undefined;
        set({ phase: "connected", connectedAt: Date.now(), error: null });
      } else if (pc.connectionState === "failed") {
        set({ error: "relay-unavailable" });
        void get().end();
      } else if (pc.connectionState === "closed" && !session.stopping) {
        void get().end();
      }
    };

    session.connectTimer = setTimeout(() => {
      set({ error: "connection-timeout" });
      void get().end();
    }, VOICE_CALL_CONNECT_TIMEOUT_MS);
  }

  async function handleSignal(envelope: VoiceSignalEnvelope, onReady?: () => Promise<void>) {
    if (
      envelope.version !== 1 ||
      envelope.callId !== session.callId ||
      envelope.senderId !== session.peerId
    ) return;

    if (envelope.kind === "ack") {
      const ackFor = envelope.ackFor ?? (envelope.payload as { ackFor?: string } | undefined)?.ackFor;
      if (ackFor) session.acknowledgedMessageIds.add(ackFor);
      return;
    }

    await sendAck(envelope.messageId);
    if (session.receivedMessageIds.has(envelope.messageId)) return;
    session.receivedMessageIds.add(envelope.messageId);

    const payload = (envelope.payload ?? {}) as {
      description?: unknown;
      candidate?: unknown;
    };

    if (envelope.kind === "ready") {
      await onReady?.();
      return;
    }

    if (envelope.kind === "offer" && session.pc) {
      if (session.lastOfferMessageId === envelope.messageId) {
        if (session.lastAnswer) await sendReliable({ kind: "answer", description: session.lastAnswer }, 2);
        return;
      }
      session.lastOfferMessageId = envelope.messageId;
      await session.pc.setRemoteDescription(new RTCSessionDescription(payload.description as any));
      session.remoteDescriptionSet = true;
      await flushCandidates();
      const answer = await session.pc.createAnswer();
      await session.pc.setLocalDescription(answer);
      session.lastAnswer = serializableDescription(answer);
      session.answerSent = true;
      await sendReliable({ kind: "answer", description: session.lastAnswer });
      return;
    }

    if (envelope.kind === "answer" && session.pc) {
      if (!session.remoteDescriptionSet) {
        await session.pc.setRemoteDescription(new RTCSessionDescription(payload.description as any));
        session.remoteDescriptionSet = true;
        await flushCandidates();
      }
      return;
    }

    if (envelope.kind === "ice") {
      if (session.pc && session.remoteDescriptionSet) {
        await session.pc.addIceCandidate(new RTCIceCandidate(payload.candidate as any));
      } else {
        session.pendingCandidates.push(payload.candidate);
      }
      return;
    }

    if (envelope.kind === "hangup") {
      stopSession();
      set(IDLE);
    }
  }

  async function attachChannel(callId: string, onReady?: () => Promise<void>) {
    await voiceCallService.prepareRealtimeAuth();
    const channel = voiceCallService.createSignalChannel(callId);
    session.channel = channel;
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void handleSignal(payload as VoiceSignalEnvelope, onReady).catch(() => {
        if (!session.stopping) set({ error: "signaling-unavailable" });
      });
    });

    await new Promise<void>((resolve, reject) => {
      let subscribed = false;
      const scheduleReconnect = () => {
        if (session.stopping || session.reconnecting) return;
        session.reconnecting = true;
        session.reconnectTimer = setTimeout(() => {
          void attachChannel(callId, onReady).catch(() => {
            session.reconnecting = false;
            set({ error: "signaling-unavailable" });
          });
        }, 800);
      };

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          const wasReconnect = session.reconnecting;
          subscribed = true;
          session.reconnecting = false;
          resolve();
          if (wasReconnect) void onReady?.();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (subscribed) scheduleReconnect();
          else reject(new Error("signaling-unavailable"));
        }
        if (status === "CLOSED") scheduleReconnect();
      });
    });
  }

  return {
    ...IDLE,

    startCall: async (roomId, peer) => {
      if (!VOICE_CALL_SUPPORTED || get().phase !== "idle") return;
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      session.stopping = false;
      session.callId = null;
      session.userId = userId;
      session.peerId = peer.id;
      set({ roomId, peer, direction: "outgoing", phase: "ringing", error: null, audioPlaybackBlocked: false });
      try {
        const call = await voiceCallService.createCall(roomId, userId, peer.id);
        session.callId = call.id;
        set({ callId: call.id });
        await attachChannel(call.id, async () => {
          if (get().phase === "ringing") set({ phase: "connecting" });
          session.readySent = true;
          await sendReliable({ kind: "ready" }, 3);
          await ensureCallerOffer(true);
        });
        session.readySent = true;
        await sendReliable({ kind: "ready" }, 3);
        voiceCallAudio.startRingback();
        session.ringTimer = setTimeout(() => {
          set({ error: "connection-timeout" });
          void get().end();
        }, VOICE_CALL_RING_TIMEOUT_MS);
      } catch (error) {
        const callId = get().callId;
        if (callId) await voiceCallService.transitionCall(callId, "missed").catch(() => {});
        stopSession();
        set({ phase: "ended", direction: "outgoing", error: errorCode(error) });
      }
    },

    handleIncoming: (call, peer) => {
      if (get().phase !== "idle") {
        void voiceCallService.transitionCall(call.id, "declined").catch(() => {});
        return;
      }
      session.stopping = false;
      session.callId = call.id;
      session.userId = useAuthStore.getState().user?.id ?? null;
      session.peerId = peer.id;
      set({ callId: call.id, roomId: call.room_id, peer, direction: "incoming", phase: "ringing", error: null, audioPlaybackBlocked: false });
      voiceCallAudio.startRingtone();
      session.ringTimer = setTimeout(() => void get().decline(), VOICE_CALL_RING_TIMEOUT_MS);
    },

    handleCallUpdate: (call) => {
      if (call.id !== get().callId) return;
      if (call.status === "answered" && get().phase === "ringing") set({ phase: "connecting" });
      if (["declined", "missed", "ended"].includes(call.status)) {
        // Remote lifecycle events only tear down local resources. They must not
        // write another terminal status back to the database.
        stopSession();
        set(IDLE);
      }
    },

    accept: async () => {
      const callId = get().callId;
      if (!callId || get().direction !== "incoming" || get().phase !== "ringing") return;
      try {
        clearTimeout(session.ringTimer);
        set({ phase: "connecting", error: null });
        const local = await getMicrophone();
        await attachChannel(callId, async () => {
          await sendReliable({ kind: "ready" }, 3);
        });
        await voiceCallService.transitionCall(callId, "answered");
        await createPeerConnection(local);
        voiceCallAudio.start();
        session.readySent = true;
        await sendReliable({ kind: "ready" });
      } catch (error) {
        set({ error: errorCode(error) });
        await get().end();
      }
    },

    decline: async () => {
      const callId = get().callId;
      if (callId) await voiceCallService.transitionCall(callId, "declined").catch(() => {});
      stopSession();
      set(IDLE);
    },

    end: async () => {
      const callId = get().callId;
      if (callId) await voiceCallService.transitionCall(callId, "ended").catch(() => {});
      try {
        if (session.channel && session.callId && session.userId) {
          await sendSignal({ kind: "hangup" });
        }
      } catch {
        // The database lifecycle is authoritative when the channel is gone.
      }
      stopSession();
      set(IDLE);
    },

    retryCall: async () => {
      const roomId = get().roomId;
      const peer = get().peer;
      const direction = get().direction;
      if (direction !== "outgoing" || !roomId || !peer) return;
      stopSession();
      set(IDLE);
      await get().startCall(roomId, peer);
    },

    resumeRemoteAudio: async () => {
      const playing = await voiceCallAudio.resumeRemoteAudio();
      set({ audioPlaybackBlocked: !playing, error: playing ? null : "audio-playback-blocked" });
    },

    dismissError: () => set({ error: null, audioPlaybackBlocked: false }),

    toggleMic: () => {
      const enabled = !get().micEnabled;
      session.localStream?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
      set({ micEnabled: enabled });
    },

    toggleSpeaker: () => {
      const enabled = !get().speakerEnabled;
      voiceCallAudio.setSpeaker(enabled);
      set({ speakerEnabled: enabled });
    },
  };
});

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
import { getIceServers, VOICE_CALL_CONNECT_TIMEOUT_MS, VOICE_CALL_RING_TIMEOUT_MS } from "@/src/lib/constants";
import { voiceCallService, type VoiceSignal } from "@/src/services/voiceCallService";
import { useAuthStore } from "@/src/stores/authStore";
import type { Call, VoiceCallStatus } from "@/src/types";

export type VoiceCallPhase = "idle" | "ringing" | "connecting" | "connected" | "ended";

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
  error: string | null;
  startCall: (roomId: string, peer: PeerInfo) => Promise<void>;
  handleIncoming: (call: Call, peer: PeerInfo) => void;
  handleCallUpdate: (call: Call) => void;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  end: () => Promise<void>;
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
}

const session: Session = {
  pc: null,
  channel: null,
  localStream: null,
  remoteDescriptionSet: false,
  pendingCandidates: [],
};

const IDLE: Pick<VoiceCallState, "callId" | "roomId" | "peer" | "direction" | "phase" | "micEnabled" | "speakerEnabled" | "connectedAt" | "error"> = {
  callId: null,
  roomId: null,
  peer: null,
  direction: null,
  phase: "idle",
  micEnabled: true,
  speakerEnabled: false,
  connectedAt: null,
  error: null,
};

async function getMicrophone(): Promise<VoiceMediaStream> {
  if (!mediaDevices) throw new Error("microphone-unavailable");
  return (await mediaDevices.getUserMedia({ audio: true, video: false })) as VoiceMediaStream;
}

function clearTimers() {
  clearTimeout(session.ringTimer);
  clearTimeout(session.connectTimer);
  session.ringTimer = undefined;
  session.connectTimer = undefined;
}

function stopSession() {
  clearTimers();
  session.channel?.unsubscribe();
  session.channel = null;
  session.pc?.close();
  session.pc = null;
  session.localStream?.getTracks().forEach((track) => track.stop());
  session.localStream = null;
  session.remoteDescriptionSet = false;
  session.pendingCandidates = [];
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
      // A late ICE candidate is harmless after a peer connection closes.
    }
  }
}

export const useVoiceCallStore = create<VoiceCallState>((set, get) => {
  async function sendSignal(signal: VoiceSignal) {
    await session.channel?.send({ type: "broadcast", event: "signal", payload: signal });
  }

  async function createPeerConnection(callId: string, localStream: VoiceMediaStream) {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });
    session.pc = pc;
    session.localStream = localStream;
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    (pc as any).ontrack = (event: any) => {
      if (event.streams?.[0]) {
        voiceCallAudio.start();
        voiceCallAudio.attachRemoteAudio(event.streams[0]);
      }
    };
    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) void sendSignal({ kind: "ice", candidate: event.candidate });
    };
    (pc as any).onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        clearTimeout(session.connectTimer);
        set({ phase: "connected", connectedAt: Date.now() });
      } else if (["failed", "closed"].includes(pc.connectionState)) {
        void get().end();
      }
    };

    session.connectTimer = setTimeout(() => void get().end(), VOICE_CALL_CONNECT_TIMEOUT_MS);
    return callId;
  }

  async function attachChannel(callId: string, onReady?: () => Promise<void>) {
    const channel = voiceCallService.createSignalChannel(callId);
    session.channel = channel;
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      void (async () => {
        const signal = payload as VoiceSignal;
        if (signal.kind === "ready") {
          await onReady?.();
          return;
        }
        if (signal.kind === "offer" && session.pc) {
          await session.pc.setRemoteDescription(new RTCSessionDescription(signal.description as any));
          session.remoteDescriptionSet = true;
          await flushCandidates();
          const answer = await session.pc.createAnswer();
          await session.pc.setLocalDescription(answer);
          await sendSignal({ kind: "answer", description: answer });
          return;
        }
        if (signal.kind === "answer" && session.pc) {
          await session.pc.setRemoteDescription(new RTCSessionDescription(signal.description as any));
          session.remoteDescriptionSet = true;
          await flushCandidates();
          return;
        }
        if (signal.kind === "ice") {
          if (session.pc && session.remoteDescriptionSet) {
            await session.pc.addIceCandidate(new RTCIceCandidate(signal.candidate as any));
          } else {
            session.pendingCandidates.push(signal.candidate);
          }
          return;
        }
        if (signal.kind === "hangup") {
          stopSession();
          set(IDLE);
        }
      })().catch(() => void get().end());
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("signaling-unavailable"));
      });
    });
  }

  async function connectMedia(callId: string, announceReady: boolean) {
    const local = await getMicrophone();
    await createPeerConnection(callId, local);
    voiceCallAudio.start();
    if (announceReady) await sendSignal({ kind: "ready" });
  }

  return {
    ...IDLE,
    startCall: async (roomId, peer) => {
      if (!VOICE_CALL_SUPPORTED || get().phase !== "idle") return;
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      set({ roomId, peer, direction: "outgoing", phase: "ringing", error: null });
      try {
        const call = await voiceCallService.createCall(roomId, userId, peer.id);
        set({ callId: call.id });
        await attachChannel(call.id, async () => {
          if (!["ringing", "connecting"].includes(get().phase)) return;
          if (get().phase === "ringing") set({ phase: "connecting" });
          await connectMedia(call.id, false);
          if (!session.pc) return;
          const offer = await session.pc.createOffer();
          await session.pc.setLocalDescription(offer);
          await sendSignal({ kind: "offer", description: offer });
        });
        voiceCallAudio.startRingback();
        session.ringTimer = setTimeout(() => void get().end(), VOICE_CALL_RING_TIMEOUT_MS);
      } catch (error) {
        const callId = get().callId;
        if (callId) await voiceCallService.updateStatus(callId, "missed").catch(() => {});
        stopSession();
        set({ phase: "ended", direction: "outgoing", error: error instanceof Error ? error.message : "call-start-failed" });
      }
    },

    handleIncoming: (call, peer) => {
      if (get().phase !== "idle") return;
      set({ callId: call.id, roomId: call.room_id, peer, direction: "incoming", phase: "ringing", error: null });
      voiceCallAudio.startRingtone();
      session.ringTimer = setTimeout(() => void get().decline(), VOICE_CALL_RING_TIMEOUT_MS);
    },

    handleCallUpdate: (call) => {
      if (call.id !== get().callId) return;
      const status = call.status as VoiceCallStatus;
      if (status === "answered" && get().phase === "ringing") set({ phase: "connecting" });
      if (["declined", "missed", "ended"].includes(status)) void get().end();
    },

    accept: async () => {
      const callId = get().callId;
      if (!callId || get().direction !== "incoming" || get().phase !== "ringing") return;
      try {
        clearTimeout(session.ringTimer);
        set({ phase: "connecting" });
        await voiceCallService.updateStatus(callId, "answered");
        await attachChannel(callId);
        await connectMedia(callId, true);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : "call-connect-failed" });
        await get().end();
      }
    },

    decline: async () => {
      const callId = get().callId;
      if (callId) await voiceCallService.updateStatus(callId, "declined").catch(() => {});
      stopSession();
      set(IDLE);
    },

    end: async () => {
      const callId = get().callId;
      if (callId) {
        await voiceCallService.updateStatus(callId, "ended").catch(() => {});
        await session.channel?.send({ type: "broadcast", event: "signal", payload: { kind: "hangup" } }).catch(() => {});
      }
      stopSession();
      set(IDLE);
    },

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

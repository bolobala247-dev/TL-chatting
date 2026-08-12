import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  VOICE_CALL_SUPPORTED,
  type CallMediaStream,
} from "@/src/lib/voiceCall";
import { voiceCallAudio } from "@/src/lib/voiceCallAudio";
import {
  VOICE_CALL_CONNECT_TIMEOUT_MS,
  VOICE_CALL_RING_TIMEOUT_MS,
  FEATURE_VIDEO_CALLS,
} from "@/src/lib/constants";
import {
  voiceCallService,
  type VoiceSignal,
  type VoiceSignalEnvelope,
} from "@/src/services/voiceCallService";
import { useAuthStore } from "@/src/stores/authStore";
import type { Call, CallType } from "@/src/types";

export type VoiceCallPhase = "idle" | "ringing" | "connecting" | "connected" | "ended";
export type CallFailureCode =
  | "permission-denied"
  | "microphone-unavailable"
  | "signaling-unavailable"
  | "relay-unavailable"
  | "connection-timeout"
  | "audio-playback-blocked"
  | "camera-permission-denied"
  | "camera-unavailable"
  | "camera-switch-failed"
  | "peer-video-unsupported"
  | "quota-exceeded"
  | "call-connect-failed";

export type CallNoticeCode = "camera-unavailable" | "camera-permission-denied" | "peer-video-unsupported";
export type CallMediaState = { audioEnabled: boolean; videoEnabled: boolean; revision: number };

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
  callType: CallType;
  localStream: CallMediaStream | null;
  remoteStream: CallMediaStream | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  cameraFacing: "user" | "environment";
  remoteMediaState: CallMediaState;
  speakerEnabled: boolean;
  connectedAt: number | null;
  error: CallFailureCode | null;
  audioPlaybackBlocked: boolean;
  startCall: (roomId: string, peer: PeerInfo, type?: CallType) => Promise<void>;
  handleIncoming: (call: Call, peer: PeerInfo) => void;
  handleCallUpdate: (call: Call) => void;
  accept: () => Promise<void>;
  decline: () => Promise<void>;
  end: () => Promise<void>;
  retryCall: () => Promise<void>;
  resumeRemoteAudio: () => Promise<void>;
  dismissError: () => void;
  toggleMic: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
  toggleSpeaker: () => void;
}

interface Session {
  pc: RTCPeerConnection | null;
  channel: RealtimeChannel | null;
  localStream: CallMediaStream | null;
  remoteStream: CallMediaStream | null;
  remoteDescriptionSet: boolean;
  pendingCandidates: unknown[];
  ringTimer?: ReturnType<typeof setTimeout>;
  connectTimer?: ReturnType<typeof setTimeout>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  turnRefreshTimer?: ReturnType<typeof setTimeout>;
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
  mediaRevision: number;
  peerSupportsVideo: boolean;
}

const session: Session = {
  pc: null,
  channel: null,
  localStream: null,
  remoteStream: null,
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
  mediaRevision: 0,
  peerSupportsVideo: false,
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
  | "callType"
  | "localStream"
  | "remoteStream"
  | "cameraEnabled"
  | "cameraFacing"
  | "remoteMediaState"
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
  callType: "audio",
  localStream: null,
  remoteStream: null,
  cameraEnabled: false,
  cameraFacing: "user",
  remoteMediaState: { audioEnabled: true, videoEnabled: true, revision: 0 },
};

const FAILURE_CODES = new Set<CallFailureCode>([
  "permission-denied",
  "microphone-unavailable",
  "signaling-unavailable",
  "relay-unavailable",
  "connection-timeout",
  "audio-playback-blocked",
  "camera-permission-denied",
  "camera-unavailable",
  "camera-switch-failed",
  "peer-video-unsupported",
  "quota-exceeded",
  "call-connect-failed",
]);

function errorCode(error: unknown): CallFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (FAILURE_CODES.has(message as CallFailureCode)) return message as CallFailureCode;
  if (/notallowed|permission|denied/i.test(message)) return "permission-denied";
  if (/notfound|microphone|media/i.test(message)) return "microphone-unavailable";
  return "call-connect-failed";
}

function supportedCallTypes(): CallType[] {
  return FEATURE_VIDEO_CALLS ? ["audio", "video"] : ["audio"];
}

async function getLocalMedia(type: CallType): Promise<CallMediaStream> {
  if (!mediaDevices) throw new Error("microphone-unavailable");
  try {
    const stream = (await mediaDevices.getUserMedia(type === "video" ? {
      audio: true,
      video: {
        facingMode: "user",
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 24, max: 24 },
      },
    } : { audio: true, video: false })) as CallMediaStream;
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("microphone-unavailable");
    }
    if (type === "video" && stream.getVideoTracks().length === 0) {
      return stream;
    }
    return stream;
  } catch (error) {
    if (type === "video") {
      try {
        const audioOnly = await mediaDevices.getUserMedia({ audio: true, video: false }) as CallMediaStream;
        if (audioOnly.getAudioTracks().length > 0) return audioOnly;
        audioOnly.getTracks().forEach((track) => track.stop());
      } catch {
        // The microphone-specific error below remains authoritative.
      }
    }
    const code = errorCode(error);
    if (type === "video" && code === "permission-denied") throw new Error("camera-permission-denied");
    throw new Error(code);
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
  clearTimeout(session.turnRefreshTimer);
  session.ringTimer = undefined;
  session.connectTimer = undefined;
  session.reconnectTimer = undefined;
  session.turnRefreshTimer = undefined;
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
  session.remoteStream?.getTracks().forEach((track) => track.stop());
  session.remoteStream = null;
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
  session.mediaRevision = 0;
  session.peerSupportsVideo = false;
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
      const local = await getLocalMedia(get().callType);
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

  async function createPeerConnection(localStream: CallMediaStream) {
    const pc = new RTCPeerConnection({
      iceServers: await voiceCallService.getIceServers(session.callId ?? undefined),
    });
    session.pc = pc;
    session.localStream = localStream;
    set({ localStream, cameraEnabled: localStream.getVideoTracks().some((track) => track.enabled) });
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    (pc as any).ontrack = (event: any) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      session.remoteStream = stream;
      set({ remoteStream: stream });
      voiceCallAudio.start(get().callType);
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
        const cameraWarning = get().callType === "video" && localStream.getVideoTracks().length === 0
          ? "camera-unavailable"
          : null;
        set({ phase: "connected", connectedAt: Date.now(), error: cameraWarning });
      } else if (pc.connectionState === "failed") {
        set({ error: "relay-unavailable" });
        void get().end();
      } else if (pc.connectionState === "closed" && !session.stopping) {
        void get().end();
      }
    };

    // Cloudflare credentials are issued for one hour. Refresh ten minutes
    // early and use an ICE restart so long-running calls remain connected.
    session.turnRefreshTimer = setTimeout(() => {
      void (async () => {
        // The caller coordinates ICE restarts; the callee only answers the
        // resulting offer, preventing simultaneous-offer glare.
        if (session.stopping || get().direction !== "outgoing" || !session.pc || !session.callId) return;
        try {
          const iceServers = await voiceCallService.getIceServers(session.callId, { forceRefresh: true });
          session.pc.setConfiguration({ iceServers });
          const offer = await session.pc.createOffer({ iceRestart: true });
          await session.pc.setLocalDescription(offer);
          session.lastOfferDescription = serializableDescription(offer);
          await sendReliable({ kind: "offer", description: session.lastOfferDescription }, 3);
        } catch {
          // Keep the existing candidate pair alive; a later network change can
          // still reconnect through the normal failed-state path.
        }
      })();
    }, 50 * 60_000);

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
      supportedCallTypes?: CallType[];
      audioEnabled?: boolean;
      videoEnabled?: boolean;
      revision?: number;
    };

    if (envelope.kind === "ready") {
      session.peerSupportsVideo = payload.supportedCallTypes?.includes("video") ?? false;
      if (get().callType === "video" && !session.peerSupportsVideo) {
        set({ error: "peer-video-unsupported" });
        await get().end();
        return;
      }
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
      // Initial answers and ICE-restart answers are only valid while the
      // connection has a local offer. This also ignores duplicate answers.
      if (session.pc.signalingState === "have-local-offer") {
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

    if (envelope.kind === "media-state") {
      const revision = payload.revision ?? 0;
      if (revision > get().remoteMediaState.revision) {
        set({ remoteMediaState: {
          audioEnabled: payload.audioEnabled !== false,
          videoEnabled: payload.videoEnabled !== false,
          revision,
        } });
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

    startCall: async (roomId, peer, requestedType = "audio") => {
      if (!VOICE_CALL_SUPPORTED || get().phase !== "idle") return;
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      session.stopping = false;
      session.callId = null;
      session.userId = userId;
      session.peerId = peer.id;
      set({ roomId, peer, direction: "outgoing", phase: "ringing", error: null, audioPlaybackBlocked: false });
      try {
        const callType: CallType = requestedType === "video" && FEATURE_VIDEO_CALLS ? "video" : "audio";
      set({ callType, speakerEnabled: callType === "video" });
        const call = await voiceCallService.createCall(roomId, userId, peer.id, callType);
        session.callId = call.id;
        set({ callId: call.id });
        await attachChannel(call.id, async () => {
          if (get().phase === "ringing") set({ phase: "connecting" });
          session.readySent = true;
          await sendReliable({ kind: "ready", protocolVersion: 1, supportedCallTypes: supportedCallTypes() }, 3);
          await ensureCallerOffer(true);
        });
        session.readySent = true;
        await sendReliable({ kind: "ready", protocolVersion: 1, supportedCallTypes: supportedCallTypes() }, 3);
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
      const callType: CallType = call.type === "video" ? "video" : "audio";
      set({ callId: call.id, roomId: call.room_id, peer, direction: "incoming", phase: "ringing", callType, speakerEnabled: callType === "video", error: null, audioPlaybackBlocked: false });
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
        set({ phase: "connecting", speakerEnabled: get().callType === "video", error: null });
        const local = await getLocalMedia(get().callType);
        await attachChannel(callId, async () => {
          if (session.pc) await sendReliable({ kind: "ready", protocolVersion: 1, supportedCallTypes: supportedCallTypes() }, 3);
        });
        await voiceCallService.transitionCall(callId, "answered");
        await createPeerConnection(local);
        voiceCallAudio.start(get().callType);
        session.readySent = true;
        await sendReliable({ kind: "ready", protocolVersion: 1, supportedCallTypes: supportedCallTypes() });
        await sendReliable({ kind: "media-state", audioEnabled: true, videoEnabled: local.getVideoTracks().length > 0, revision: ++session.mediaRevision }, 2);
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
      await get().startCall(roomId, peer, get().callType);
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
      void sendReliable({ kind: "media-state", audioEnabled: enabled, videoEnabled: get().cameraEnabled, revision: ++session.mediaRevision }, 2).catch(() => {});
    },

    toggleCamera: () => {
      const track = session.localStream?.getVideoTracks()[0];
      if (!track) { set({ error: "camera-unavailable" }); return; }
      track.enabled = !track.enabled;
      set({ cameraEnabled: track.enabled });
      void sendReliable({ kind: "media-state", audioEnabled: get().micEnabled, videoEnabled: track.enabled, revision: ++session.mediaRevision }, 2).catch(() => {});
    },

    switchCamera: async () => {
      const oldTrack = session.localStream?.getVideoTracks()[0];
      if (!oldTrack || !mediaDevices || !session.pc) { set({ error: "camera-switch-failed" }); return; }
      try {
        const facing = get().cameraFacing === "user" ? "environment" : "user";
        const next = await mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facing, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 }, frameRate: { ideal: 24, max: 24 } },
        }) as CallMediaStream;
        const newTrack = next.getVideoTracks()[0];
        if (!newTrack) throw new Error("camera-switch-failed");
        const sender = session.pc.getSenders().find((candidate: any) => candidate.track?.kind === "video");
        await sender?.replaceTrack(newTrack);
        const stream = session.localStream;
        if (!stream) throw new Error("camera-switch-failed");
        stream.removeTrack?.(oldTrack);
        stream.addTrack(newTrack);
        oldTrack.stop();
        set({ cameraFacing: facing, localStream: stream, cameraEnabled: newTrack.enabled });
      } catch {
        set({ error: "camera-switch-failed" });
      }
    },

    toggleSpeaker: () => {
      const enabled = !get().speakerEnabled;
      voiceCallAudio.setSpeaker(enabled);
      set({ speakerEnabled: enabled });
    },
  };
});

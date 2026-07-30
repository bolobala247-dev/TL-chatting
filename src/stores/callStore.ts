import { create } from "zustand";
import { Platform } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  startIOSPIP,
  stopIOSPIP,
  WEBRTC_SUPPORTED,
  type CallMediaStream,
} from "@/src/lib/webrtc";
import { callAudio } from "@/src/lib/callAudio";
import { callService } from "@/src/services/callService";
import { useAuthStore } from "@/src/stores/authStore";
import {
  getIceServers,
  CALL_RING_TIMEOUT_MS,
  CALL_CONNECT_TIMEOUT_MS,
} from "@/src/lib/constants";
import type { Call, CallType, CallStatus } from "@/src/types";

// Lifecycle the UI reacts to. Terminal states collapse into "ended".
export type CallPhase =
  | "idle"
  | "ringing" // outgoing: waiting for answer / incoming: waiting for accept
  | "connecting" // answered, negotiating media
  | "connected" // media flowing
  | "ended";

interface PeerInfo {
  id: string;
  name: string;
  avatar: string | null;
}

interface CallStoreState {
  callId: string | null;
  roomId: string | null;
  peer: PeerInfo | null;
  callType: CallType | null;
  direction: "incoming" | "outgoing" | null;
  phase: CallPhase;
  endReason: CallStatus | null;

  localStream: CallMediaStream | null;
  remoteStream: CallMediaStream | null;

  micEnabled: boolean;
  cameraEnabled: boolean;
  speakerEnabled: boolean;
  isFrontCamera: boolean;
  isPipActive: boolean;

  // Epoch ms of when media connected — the UI derives duration from it.
  connectedAt: number | null;

  startCall: (
    roomId: string,
    peer: PeerInfo,
    type: CallType
  ) => Promise<void>;
  handleIncomingRow: (call: Call, peer: PeerInfo) => void;
  handleRowUpdate: (call: Call) => void;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleSpeaker: () => void;
  switchCamera: () => void;
  setPipActive: (active: boolean) => void;
  /** Registers the RTCPIPView node (iOS) so PiP can be toggled from controls. */
  setPipView: (ref: unknown) => void;
}

// Non-render session refs (peer connection, channel, timers, ICE queue).
// Kept out of the store so they never trigger re-renders.
interface Session {
  pc: RTCPeerConnection | null;
  channel: RealtimeChannel | null;
  pendingCandidates: any[];
  remoteDescSet: boolean;
  ringTimer?: ReturnType<typeof setTimeout>;
  connectTimer?: ReturnType<typeof setTimeout>;
  // RTCPIPView node (iOS) that PiP start/stop attaches to
  pipRef: unknown;
}

const session: Session = {
  pc: null,
  channel: null,
  pendingCandidates: [],
  remoteDescSet: false,
  pipRef: null,
};

const IDLE_STATE = {
  callId: null,
  roomId: null,
  peer: null,
  callType: null,
  direction: null,
  phase: "idle" as CallPhase,
  endReason: null,
  localStream: null,
  remoteStream: null,
  micEnabled: true,
  cameraEnabled: true,
  speakerEnabled: false,
  isFrontCamera: true,
  isPipActive: false,
  connectedAt: null,
};

async function getLocalMedia(type: CallType): Promise<CallMediaStream> {
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video:
      type === "video"
        ? { facingMode: "user", frameRate: 30, width: 1280, height: 720 }
        : false,
  });
  return stream as unknown as CallMediaStream;
}

export const useCallStore = create<CallStoreState>((set, get) => {
  // Attach the peer connection: pipe local tracks out, remote in, trickle ICE.
  function createPeerConnection(callId: string, local: CallMediaStream) {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });

    local.getTracks().forEach((track) => pc.addTrack(track, local));

    (pc as any).ontrack = (event: any) => {
      const [stream] = event.streams;
      if (stream) set({ remoteStream: stream as CallMediaStream });
    };

    (pc as any).onicecandidate = (event: any) => {
      if (event.candidate) {
        session.channel?.send({
          type: "broadcast",
          event: "ice",
          payload: { candidate: event.candidate },
        });
      }
    };

    (pc as any).onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        clearTimeout(session.connectTimer);
        if (get().phase !== "connected") {
          set({ phase: "connected", connectedAt: Date.now() });
        }
      } else if (state === "failed") {
        void get().endCall();
      }
    };

    session.pc = pc;
    return pc;
  }

  async function drainCandidates() {
    if (!session.pc) return;
    const queued = session.pendingCandidates;
    session.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // best-effort ICE; a dropped candidate won't fail the whole call
      }
    }
  }

  // Wire broadcast handlers shared by both sides of the call.
  function attachSignalHandlers(channel: RealtimeChannel, isCaller: boolean) {
    channel.on("broadcast", { event: "ice" }, async ({ payload }) => {
      const candidate = payload?.candidate;
      if (!candidate) return;
      if (session.remoteDescSet && session.pc) {
        try {
          await session.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // ignore malformed candidate
        }
      } else {
        session.pendingCandidates.push(candidate);
      }
    });

    if (isCaller) {
      // Callee finished setup — safe to send the offer now (no lost-offer race)
      channel.on("broadcast", { event: "ready" }, async () => {
        if (!session.pc) return;
        try {
          const offer = await session.pc.createOffer({});
          await session.pc.setLocalDescription(offer);
          channel.send({
            type: "broadcast",
            event: "offer",
            payload: { sdp: offer },
          });
        } catch (err) {
          console.error("[callStore] create offer", err);
        }
      });

      channel.on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (!session.pc || !payload?.sdp) return;
        try {
          await session.pc.setRemoteDescription(
            new RTCSessionDescription(payload.sdp)
          );
          session.remoteDescSet = true;
          await drainCandidates();
        } catch (err) {
          console.error("[callStore] set answer", err);
        }
      });
    } else {
      channel.on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (!session.pc || !payload?.sdp) return;
        try {
          await session.pc.setRemoteDescription(
            new RTCSessionDescription(payload.sdp)
          );
          session.remoteDescSet = true;
          await drainCandidates();
          const answer = await session.pc.createAnswer();
          await session.pc.setLocalDescription(answer);
          channel.send({
            type: "broadcast",
            event: "answer",
            payload: { sdp: answer },
          });
        } catch (err) {
          console.error("[callStore] handle offer", err);
        }
      });
    }
  }

  // Tear everything down and either reset to idle or show the ended state.
  function teardown(reason: CallStatus | null, showEnded: boolean) {
    clearTimeout(session.ringTimer);
    clearTimeout(session.connectTimer);

    callAudio.stopRingtone();
    callAudio.stopRingback();
    callAudio.stop();

    get().localStream?.getTracks().forEach((t) => t.stop());

    if (session.pc) {
      try {
        (session.pc as any).ontrack = null;
        (session.pc as any).onicecandidate = null;
        (session.pc as any).onconnectionstatechange = null;
        session.pc.close();
      } catch {
        // already closed
      }
    }
    session.pc = null;

    if (session.channel) {
      session.channel.unsubscribe();
      session.channel = null;
    }
    session.pendingCandidates = [];
    session.remoteDescSet = false;
    session.pipRef = null;

    if (showEnded) {
      set({ ...IDLE_STATE, phase: "ended", endReason: reason });
      setTimeout(() => {
        // Only clear if a new call hasn't started in the meantime
        if (get().phase === "ended") set({ ...IDLE_STATE });
      }, 1500);
    } else {
      set({ ...IDLE_STATE });
    }
  }

  return {
    ...IDLE_STATE,

    startCall: async (roomId, peer, type) => {
      if (!WEBRTC_SUPPORTED) return;
      if (get().phase !== "idle") return;
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      set({
        roomId,
        peer,
        callType: type,
        direction: "outgoing",
        phase: "ringing",
        cameraEnabled: type === "video",
        speakerEnabled: type === "video",
      });

      try {
        const local = await getLocalMedia(type);
        set({ localStream: local });

        const call = await callService.createCall(
          roomId,
          userId,
          peer.id,
          type
        );
        set({ callId: call.id });

        callAudio.start(type);
        callAudio.startRingback();

        const channel = callService.createSignalChannel(call.id, userId);
        session.channel = channel;
        attachSignalHandlers(channel, true);
        channel.subscribe();

        createPeerConnection(call.id, local);

        // No answer within the window → the callee missed it
        session.ringTimer = setTimeout(() => {
          if (get().phase === "ringing") {
            void callService
              .updateStatus(call.id, "missed", {
                ended_at: new Date().toISOString(),
              })
              .catch(() => {});
            teardown("missed", true);
          }
        }, CALL_RING_TIMEOUT_MS);
      } catch (err) {
        console.error("[callStore] startCall", err);
        const id = get().callId;
        if (id) {
          void callService
            .updateStatus(id, "ended", { ended_at: new Date().toISOString() })
            .catch(() => {});
        }
        teardown("ended", false);
      }
    },

    handleIncomingRow: (call, peer) => {
      // Busy: silently auto-decline a second incoming call
      if (get().phase !== "idle") {
        void callService.updateStatus(call.id, "declined").catch(() => {});
        return;
      }

      set({
        callId: call.id,
        roomId: call.room_id,
        peer,
        callType: call.type as CallType,
        direction: "incoming",
        phase: "ringing",
        cameraEnabled: call.type === "video",
        speakerEnabled: call.type === "video",
      });

      callAudio.startRingtone();
    },

    // Lifecycle changes from the peer arrive via the global calls subscription.
    handleRowUpdate: (call) => {
      if (call.id !== get().callId) return;
      const phase = get().phase;

      if (
        (call.status === "declined" ||
          call.status === "missed" ||
          call.status === "ended") &&
        phase !== "ended"
      ) {
        teardown(call.status as CallStatus, phase === "connected");
      } else if (call.status === "answered" && get().direction === "outgoing") {
        callAudio.stopRingback();
        clearTimeout(session.ringTimer);
        if (phase === "ringing") set({ phase: "connecting" });
      }
    },

    acceptCall: async () => {
      const { callId, callType, phase } = get();
      if (!callId || !callType || phase !== "ringing") return;
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      callAudio.stopRingtone();
      set({ phase: "connecting" });

      try {
        await callService.updateStatus(callId, "answered", {
          answered_at: new Date().toISOString(),
        });

        const local = await getLocalMedia(callType);
        set({ localStream: local });

        callAudio.start(callType);

        const channel = callService.createSignalChannel(callId, userId);
        session.channel = channel;
        attachSignalHandlers(channel, false);

        createPeerConnection(callId, local);

        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            // Tell the caller we're ready to receive the offer
            channel.send({ type: "broadcast", event: "ready", payload: {} });
          }
        });

        session.connectTimer = setTimeout(() => {
          if (get().phase !== "connected") void get().endCall();
        }, CALL_CONNECT_TIMEOUT_MS);
      } catch (err) {
        console.error("[callStore] acceptCall", err);
        void callService
          .updateStatus(callId, "ended", { ended_at: new Date().toISOString() })
          .catch(() => {});
        teardown("ended", false);
      }
    },

    declineCall: async () => {
      const { callId } = get();
      if (callId) {
        void callService.updateStatus(callId, "declined").catch(() => {});
      }
      teardown("declined", false);
    },

    endCall: async () => {
      const { callId, phase, connectedAt } = get();
      if (callId && phase !== "ended") {
        const wasConnected = phase === "connected" && connectedAt != null;
        const duration = wasConnected
          ? Math.round((Date.now() - connectedAt!) / 1000)
          : undefined;
        // Never answered → the callee missed it; otherwise a normal end
        const status: CallStatus = wasConnected ? "ended" : "missed";
        void callService
          .updateStatus(callId, status, {
            ended_at: new Date().toISOString(),
            ...(duration != null ? { duration_seconds: duration } : {}),
          })
          .catch(() => {});
        session.channel?.send({ type: "broadcast", event: "hangup", payload: {} });
        teardown(status, wasConnected);
      } else {
        teardown("ended", false);
      }
    },

    toggleMic: () => {
      const enabled = !get().micEnabled;
      get()
        .localStream?.getAudioTracks()
        .forEach((t) => {
          t.enabled = enabled;
        });
      set({ micEnabled: enabled });
    },

    toggleCamera: () => {
      const enabled = !get().cameraEnabled;
      get()
        .localStream?.getVideoTracks()
        .forEach((t) => {
          t.enabled = enabled;
        });
      set({ cameraEnabled: enabled });
    },

    toggleSpeaker: () => {
      const on = !get().speakerEnabled;
      callAudio.setSpeaker(on);
      set({ speakerEnabled: on });
    },

    switchCamera: () => {
      // react-native-webrtc exposes _switchCamera on the local video track
      if (Platform.OS === "web") return;
      const track = get().localStream?.getVideoTracks()[0] as any;
      track?._switchCamera?.();
      set({ isFrontCamera: !get().isFrontCamera });
    },

    setPipActive: (active) => {
      // Best-effort: native PiP is ultimately driven by the OS controller.
      if (active) startIOSPIP(session.pipRef);
      else stopIOSPIP(session.pipRef);
      set({ isPipActive: active });
    },

    setPipView: (ref) => {
      session.pipRef = ref;
    },
  };
});

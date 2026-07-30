/**
 * Call audio routing — NATIVE.
 *
 * Wraps react-native-incall-manager so the call store can toggle the
 * speaker, manage the audio session (proximity sensor, wake lock) and play
 * ring / ringback tones without importing the native module directly.
 */
import InCallManager from "react-native-incall-manager";
import type { CallType } from "@/src/types";

export const callAudio = {
  /** Open the in-call audio session. Video defaults to speakerphone. */
  start(type: CallType) {
    InCallManager.start({ media: type === "video" ? "video" : "audio", auto: true });
    InCallManager.setForceSpeakerphoneOn(type === "video");
  },
  stop() {
    InCallManager.stop();
  },
  setSpeaker(on: boolean) {
    InCallManager.setForceSpeakerphoneOn(on);
  },
  /** Callee side: incoming ringtone (loops until stopped). */
  startRingtone() {
    InCallManager.startRingtone("_DEFAULT_", [0.5, 1, 0.5, 1], "playback", 30);
  },
  stopRingtone() {
    InCallManager.stopRingtone();
  },
  /** Caller side: outgoing ringback while the peer is ringing. */
  startRingback() {
    InCallManager.start({ media: "audio" });
    InCallManager.startRingback("_DTMF_");
  },
  stopRingback() {
    InCallManager.stopRingback();
  },
};

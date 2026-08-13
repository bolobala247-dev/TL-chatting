import InCallManager from "react-native-incall-manager";
import { callDebug } from "@/src/lib/callDebug";

export const voiceCallAudio = {
  start(type: "audio" | "video" = "audio") {
    // A caller may still have the DTMF ringback active when the first remote
    // track arrives. Stop it before routing real call audio.
    InCallManager.stopRingback();
    InCallManager.stopRingtone();
    callDebug("audio:route-start", { type });
    InCallManager.start({ media: type, auto: true });
    InCallManager.setForceSpeakerphoneOn(type === "video");
  },
  stop() {
    callDebug("audio:route-stop");
    InCallManager.stop();
  },
  setSpeaker(enabled: boolean) {
    InCallManager.setForceSpeakerphoneOn(enabled);
  },
  startRingtone() {
    callDebug("audio:ringtone-start");
    InCallManager.startRingtone("_DEFAULT_", [0.5, 1, 0.5, 1], "playback", 30);
  },
  stopRingtone() {
    callDebug("audio:ringtone-stop");
    InCallManager.stopRingtone();
  },
  startRingback() {
    callDebug("audio:ringback-start");
    InCallManager.start({ media: "audio" });
    InCallManager.startRingback("_DTMF_");
  },
  stopRingback() {
    callDebug("audio:ringback-stop");
    InCallManager.stopRingback();
  },
  async attachRemoteAudio(_stream: unknown): Promise<boolean> {
    return true;
  },
  async resumeRemoteAudio(): Promise<boolean> {
    return true;
  },
};

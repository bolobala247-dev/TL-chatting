import InCallManager from "react-native-incall-manager";

export const voiceCallAudio = {
  start(type: "audio" | "video" = "audio") {
    InCallManager.start({ media: type, auto: true });
    InCallManager.setForceSpeakerphoneOn(type === "video");
  },
  stop() {
    InCallManager.stop();
  },
  setSpeaker(enabled: boolean) {
    InCallManager.setForceSpeakerphoneOn(enabled);
  },
  startRingtone() {
    InCallManager.startRingtone("_DEFAULT_", [0.5, 1, 0.5, 1], "playback", 30);
  },
  stopRingtone() {
    InCallManager.stopRingtone();
  },
  startRingback() {
    InCallManager.start({ media: "audio" });
    InCallManager.startRingback("_DTMF_");
  },
  stopRingback() {
    InCallManager.stopRingback();
  },
  async attachRemoteAudio(_stream: unknown): Promise<boolean> {
    return true;
  },
  async resumeRemoteAudio(): Promise<boolean> {
    return true;
  },
};

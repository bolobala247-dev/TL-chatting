/**
 * Call audio routing — WEB (no-op).
 *
 * Browsers route WebRTC audio to the default output automatically and offer
 * no speaker/earpiece switch, so every method here is a safe no-op. The web
 * call UI hides the speaker control accordingly.
 */
import type { CallType } from "@/src/types";

export const callAudio = {
  start(_type: CallType) {},
  stop() {},
  setSpeaker(_on: boolean) {},
  startRingtone() {},
  stopRingtone() {},
  startRingback() {},
  stopRingback() {},
};

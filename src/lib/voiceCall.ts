import { Platform } from "react-native";

import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCView,
} from "react-native-webrtc";

export {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCView,
};

export type VoiceMediaStream = MediaStream;
export type CallMediaStream = MediaStream;

// iOS is intentionally excluded from v1. Metro uses the web implementation
// for browser builds, while Android uses react-native-webrtc.
export const VOICE_CALL_SUPPORTED = Platform.OS !== "ios";

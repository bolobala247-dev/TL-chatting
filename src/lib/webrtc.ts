/**
 * WebRTC platform abstraction — NATIVE (iOS/Android).
 *
 * react-native-webrtc mirrors the browser WebRTC API, so the calling
 * store/components import everything from here and Metro swaps in
 * `webrtc.web.ts` (browser globals) on web. Media is peer-to-peer;
 * Supabase Realtime only carries the signaling handshake.
 */
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  RTCPIPView,
  startIOSPIP,
  stopIOSPIP,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
} from "react-native-webrtc";
import { Platform } from "react-native";

export {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  RTCPIPView,
  startIOSPIP,
  stopIOSPIP,
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
};

// The concrete MediaStream instance carried around the calling code.
export type CallMediaStream = MediaStream;

// react-native-webrtc is only present in native/dev builds
export const WEBRTC_SUPPORTED = true;
// PiP is driven by RTCPIPView (AVPictureInPictureController) — iOS 15+ only.
export const PIP_SUPPORTED = Platform.OS === "ios";

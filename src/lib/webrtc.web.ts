/**
 * WebRTC platform abstraction — WEB.
 *
 * Browsers ship WebRTC as globals, so we simply re-export them with the
 * same names the native module uses. Video rendering differs per platform,
 * so `RTCView` is a no-op here — the web `VideoStream` uses a <video> tag.
 */
const g = globalThis as any;

export const RTCPeerConnection = g.RTCPeerConnection;
export const RTCIceCandidate = g.RTCIceCandidate;
export const RTCSessionDescription = g.RTCSessionDescription;
export const MediaStream = g.MediaStream;
export const MediaStreamTrack = g.MediaStreamTrack;
export const mediaDevices = g.navigator?.mediaDevices;

// Native-only rendering / PiP helpers — unused on web
export const RTCView: any = () => null;
export const RTCPIPView: any = () => null;
export const startIOSPIP = () => {};
export const stopIOSPIP = () => {};

export type CallMediaStream = MediaStream;

export const WEBRTC_SUPPORTED =
  typeof g.RTCPeerConnection !== "undefined" && !!g.navigator?.mediaDevices;
// Browser PiP (documentPictureInPicture / requestPictureInPicture) is
// inconsistent across browsers, so the call UI stays inline on web.
export const PIP_SUPPORTED = false;

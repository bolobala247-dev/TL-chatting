const browser = globalThis as any;

export const RTCPeerConnection = browser.RTCPeerConnection;
export const RTCIceCandidate = browser.RTCIceCandidate;
export const RTCSessionDescription = browser.RTCSessionDescription;
export const mediaDevices = browser.navigator?.mediaDevices;
export const MediaStream = browser.MediaStream;
export const MediaStreamTrack = browser.MediaStreamTrack;

export type VoiceMediaStream = MediaStream;

export const VOICE_CALL_SUPPORTED =
  typeof browser.RTCPeerConnection !== "undefined" &&
  !!browser.navigator?.mediaDevices;

// Generic call API. The voice-prefixed implementation remains the wire-level
// compatibility layer for existing clients and Realtime topics.
export { voiceCallService as callService } from "./voiceCallService";
export type {
  CallSignal,
  CallSignalEnvelope,
  CallSignalKind,
  VoiceCallAction,
  VoiceSignal,
  VoiceSignalEnvelope,
  VoiceSignalKind,
} from "./voiceCallService";

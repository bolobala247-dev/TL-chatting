// Generic store alias for new call UI and integrations. Keeping the original
// export avoids breaking the already shipped voice-call host.
export { useVoiceCallStore as useCallStore } from "./voiceCallStore";
export type { CallFailureCode, VoiceCallPhase } from "./voiceCallStore";

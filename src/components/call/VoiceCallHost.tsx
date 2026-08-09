import { Suspense } from "react";
import { useVoiceCalls } from "@/src/hooks/useVoiceCalls";
import { useVoiceCallStore } from "@/src/stores/voiceCallStore";
import { VoiceCallOverlay } from "./VoiceCallOverlay";

export function VoiceCallHost() {
  useVoiceCalls();
  const phase = useVoiceCallStore((state) => state.phase);

  if (phase === "idle") return null;
  return (
    <Suspense fallback={null}>
      <VoiceCallOverlay />
    </Suspense>
  );
}

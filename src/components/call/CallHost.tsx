import { lazy, Suspense } from "react";
import { useCalls } from "@/src/hooks/useCalls";
import { useCallStore } from "@/src/stores/callStore";

// Lazy: the call surfaces (RTCView, controls, PiP…) only load when a call
// actually starts — CallHost itself mounts at the root on every session
const CallScreen = lazy(() =>
  import("./CallScreen").then((m) => ({ default: m.CallScreen }))
);
const IncomingCallOverlay = lazy(() =>
  import("./IncomingCallOverlay").then((m) => ({
    default: m.IncomingCallOverlay,
  }))
);

/**
 * Root-mounted calling host. Runs the global incoming-call listener and
 * renders the active call surface above every screen:
 *   • incoming + ringing → IncomingCallOverlay (accept / decline)
 *   • any other active phase → CallScreen (outgoing, connecting, connected)
 * Renders nothing while idle, so it has no cost outside of a call.
 */
export function CallHost() {
  useCalls();

  const phase = useCallStore((s) => s.phase);
  const direction = useCallStore((s) => s.direction);

  if (phase === "idle") return null;
  if (direction === "incoming" && phase === "ringing") {
    return (
      <Suspense fallback={null}>
        <IncomingCallOverlay />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={null}>
      <CallScreen />
    </Suspense>
  );
}

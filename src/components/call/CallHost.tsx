import { useCalls } from "@/src/hooks/useCalls";
import { useCallStore } from "@/src/stores/callStore";
import { CallScreen } from "./CallScreen";
import { IncomingCallOverlay } from "./IncomingCallOverlay";

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
    return <IncomingCallOverlay />;
  }
  return <CallScreen />;
}

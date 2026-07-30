import { useEffect, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { RTCPIPView, PIP_SUPPORTED } from "@/src/lib/webrtc";
import type { CallMediaStream } from "@/src/lib/webrtc";
import { useCallStore } from "@/src/stores/callStore";

interface RemoteVideoProps {
  stream: CallMediaStream | null;
  objectFit?: "cover" | "contain";
  style?: StyleProp<ViewStyle>;
}

// Remote video surface. Uses RTCPIPView so iOS can float the call into a
// Picture-in-Picture window (auto on background, or via the PiP control),
// and registers its node with the store so controls can toggle PiP.
export function RemoteVideo({
  stream,
  objectFit = "cover",
  style,
}: RemoteVideoProps) {
  const ref = useRef<any>(null);
  const setPipView = useCallStore((s) => s.setPipView);

  useEffect(() => {
    setPipView(ref.current);
    return () => setPipView(null);
  }, [setPipView]);

  if (!stream) return null;

  return (
    <RTCPIPView
      ref={ref}
      streamURL={(stream as any).toURL()}
      objectFit={objectFit}
      iosPIP={
        PIP_SUPPORTED
          ? { enabled: true, startAutomatically: true, stopAutomatically: true }
          : undefined
      }
      style={style}
    />
  );
}

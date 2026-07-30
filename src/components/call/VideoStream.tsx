import { RTCView } from "@/src/lib/webrtc";
import type { CallMediaStream } from "@/src/lib/webrtc";
import type { StyleProp, ViewStyle } from "react-native";

interface VideoStreamProps {
  stream: CallMediaStream | null;
  /** Mirror the local front-camera preview. */
  mirror?: boolean;
  objectFit?: "cover" | "contain";
  style?: StyleProp<ViewStyle>;
}

// Native video surface — RTCView renders a WebRTC MediaStream by its URL.
export function VideoStream({
  stream,
  mirror = false,
  objectFit = "cover",
  style,
}: VideoStreamProps) {
  if (!stream) return null;

  return (
    <RTCView
      streamURL={(stream as any).toURL()}
      objectFit={objectFit}
      mirror={mirror}
      style={style}
    />
  );
}

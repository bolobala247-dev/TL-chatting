import { Platform, View } from "react-native";
import type { CallMediaStream } from "@/src/lib/voiceCall";

type Props = { stream: CallMediaStream | null; mirror?: boolean; muted?: boolean; local?: boolean };

export function CallVideoView({ stream, mirror = false, muted = false, local = false }: Props) {
  if (!stream) return <View className="flex-1 bg-neutral-900" />;
  if (Platform.OS === "web") return <WebVideo stream={stream} mirror={mirror} muted={muted} />;
  return <NativeVideo stream={stream} mirror={mirror} local={local} />;
}

function NativeVideo({ stream, mirror, local }: { stream: CallMediaStream; mirror: boolean; local: boolean }) {
  // RTCView is a native-only export; keeping the require here avoids loading
  // native view registration in the browser bundle.
  const RTCView = require("@/src/lib/voiceCall").RTCView as any;
  return <RTCView streamURL={stream.toURL()} style={{ flex: 1 }} objectFit="cover" mirror={mirror} zOrder={local ? 1 : 0} />;
}

function WebVideo({ stream, mirror, muted }: { stream: CallMediaStream; mirror: boolean; muted: boolean }) {
  const React = require("react") as typeof import("react");
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream as unknown as MediaStream;
    element.play().catch(() => {});
    return () => { if ((element.srcObject as unknown) === (stream as unknown)) element.srcObject = null; };
  }, [stream]);
  return React.createElement("video", {
    ref,
    autoPlay: true,
    playsInline: true,
    muted,
    style: { width: "100%", height: "100%", objectFit: "cover", transform: mirror ? "scaleX(-1)" : undefined, backgroundColor: "#171717" },
  });
}

import { createElement, useEffect, useRef } from "react";

interface RemoteVideoProps {
  stream: any;
  objectFit?: "cover" | "contain";
  style?: any;
}

// Remote video surface — web renders a <video> bound to the MediaStream.
// (Browser PiP is inconsistent, so PIP_SUPPORTED is false on web.)
export function RemoteVideo({ stream, objectFit = "cover" }: RemoteVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null;
  }, [stream]);

  if (!stream) return null;

  return createElement("video", {
    ref,
    autoPlay: true,
    playsInline: true,
    style: { width: "100%", height: "100%", objectFit },
  });
}

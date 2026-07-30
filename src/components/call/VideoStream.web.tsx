import { createElement, useEffect, useRef } from "react";

interface VideoStreamProps {
  stream: any;
  mirror?: boolean;
  objectFit?: "cover" | "contain";
  style?: any;
}

// Web video surface — a raw <video> element bound to the MediaStream.
// Local previews are muted to avoid hearing your own microphone.
export function VideoStream({
  stream,
  mirror = false,
  objectFit = "cover",
}: VideoStreamProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream ?? null;
  }, [stream]);

  if (!stream) return null;

  return createElement("video", {
    ref,
    autoPlay: true,
    playsInline: true,
    muted: mirror,
    style: {
      width: "100%",
      height: "100%",
      objectFit,
      transform: mirror ? "scaleX(-1)" : undefined,
    },
  });
}

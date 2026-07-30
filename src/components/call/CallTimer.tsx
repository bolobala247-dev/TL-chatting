import { useEffect, useState } from "react";
import { Text } from "react-native";
import { formatCallDuration } from "@/src/lib/messageMeta";

interface CallTimerProps {
  /** Epoch ms when the call connected. */
  connectedAt: number;
  className?: string;
}

// Ticks once a second off the connect timestamp — no drift from re-renders.
export function CallTimer({ connectedAt, className }: CallTimerProps) {
  const [seconds, setSeconds] = useState(() =>
    Math.floor((Date.now() - connectedAt) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - connectedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [connectedAt]);

  return (
    <Text className={className ?? "font-sans text-body text-ink-inverse/80"}>
      {formatCallDuration(seconds)}
    </Text>
  );
}

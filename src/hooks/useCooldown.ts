import { useEffect, useState } from "react";

export function useCooldown(initialSeconds = 0) {
  const [cooldown, setCooldown] = useState(initialSeconds);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  return { cooldown, setCooldown };
}

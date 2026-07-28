import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Web-only: Vercel Web Analytics + Speed Insights (đã bật trên dashboard).
// Script chỉ hoạt động khi deploy trên Vercel; local dev sẽ no-op với debug log.
export function VercelInsights() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}

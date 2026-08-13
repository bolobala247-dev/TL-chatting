/**
 * Temporary, opt-in diagnostics for foreground WebRTC calls.
 *
 * Keep payloads deliberately small: never pass SDP, ICE candidates, tokens,
 * credentials, or raw browser error objects to this logger.
 */
export const CALL_DEBUG_ENABLED = process.env.EXPO_PUBLIC_CALL_DEBUG === "true";

export function shortCallId(value: string | null | undefined): string | undefined {
  return value ? value.slice(0, 8) : undefined;
}

export function callDebug(event: string, details: Record<string, unknown> = {}): void {
  if (!CALL_DEBUG_ENABLED) return;
  console.info(`[call-debug] ${event}`, details);
}

export function callDebugWarn(event: string, details: Record<string, unknown> = {}): void {
  if (!CALL_DEBUG_ENABLED) return;
  console.warn(`[call-debug] ${event}`, details);
}

export function summarizeCallError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message.slice(0, 160) };
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as { name?: unknown; message?: unknown; status?: unknown; code?: unknown };
    return {
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      ...(typeof candidate.message === "string" ? { message: candidate.message.slice(0, 160) } : {}),
      ...(typeof candidate.status === "number" ? { status: candidate.status } : {}),
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    };
  }
  return { message: String(error).slice(0, 160) };
}

/** Supabase: "For security purposes, you can only request this after 56 seconds." */
const RATE_LIMIT_SECONDS_RE = /after (\d+) seconds?/i;

/** Legacy GoTrue message format */
const LEGACY_RATE_LIMIT_SECONDS_RE = /once every (\d+) seconds?/i;

export type AuthFormErrorResult = {
  message: string;
  cooldownSeconds?: number;
};

type AuthRateLimitContext = "password_reset" | "signup";

export type AuthErrorDebugInfo = {
  message: string;
  code?: string;
  status?: number;
  parsedSeconds?: number;
  limitType: "email_frequency" | "project_email_quota" | "other";
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function parseRateLimitSeconds(message: string): number | undefined {
  const match =
    message.match(RATE_LIMIT_SECONDS_RE) ??
    message.match(LEGACY_RATE_LIMIT_SECONDS_RE);
  if (!match) return undefined;

  const seconds = Number.parseInt(match[1], 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function classifyAuthError(error: unknown): AuthErrorDebugInfo {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const status = getErrorStatus(error);
  const parsedSeconds = parseRateLimitSeconds(message);

  if (parsedSeconds !== undefined) {
    return { message, code, status, parsedSeconds, limitType: "email_frequency" };
  }

  if (code === "over_email_send_rate_limit") {
    return { message, code, status, limitType: "project_email_quota" };
  }

  return { message, code, status, limitType: "other" };
}

/** Dev-only: log raw Supabase auth error to inspect exact rate-limit response. */
export function logAuthErrorDebug(label: string, error: unknown): AuthErrorDebugInfo {
  const info = classifyAuthError(error);

  if (__DEV__) {
    console.warn(`[${label}] Supabase auth error`, {
      ...info,
      raw: error,
    });
  }

  return info;
}

/**
 * Maps Supabase Auth errors to Vietnamese UI messages.
 * Parses exact cooldown from per-email frequency limits when Supabase includes seconds.
 */
export function formatAuthFormError(
  error: unknown,
  fallback: string,
  context: AuthRateLimitContext,
): AuthFormErrorResult {
  const info = classifyAuthError(error);
  const action = context === "signup" ? "đăng ký" : "gửi yêu cầu";

  if (info.limitType === "email_frequency" && info.parsedSeconds) {
    return {
      message: `Bạn đã ${action} quá nhiều lần. Vui lòng đợi ${info.parsedSeconds} giây rồi thử lại.`,
      cooldownSeconds: info.parsedSeconds,
    };
  }

  if (info.limitType === "project_email_quota") {
    return {
      message:
        "Project đã vượt giới hạn gửi email (SMTP mặc định: ~2 email/giờ). Kiểm tra Supabase Dashboard → Authentication → Rate Limits, hoặc cấu hình SMTP tùy chỉnh để test nhanh hơn.",
    };
  }

  if (info.status === 429) {
    return {
      message: `Quá nhiều yêu cầu ${action}. Supabase không trả về thời gian chờ — mở console (log [${context}]) để xem chi tiết.`,
    };
  }

  return { message: info.message || fallback };
}

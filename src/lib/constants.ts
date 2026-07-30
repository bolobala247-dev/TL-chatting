export const MESSAGES_PER_PAGE = 20;
export const MEDIA_PER_PAGE = 30;
// Bounded in-memory message cache (RAM tier only — no persistence).
// Active room holds up to MESSAGE_WINDOW_SIZE messages; leaving a room trims
// it to ROOM_CACHE_TRIM_SIZE (still an instant re-open paint); at most
// MAX_CACHED_ROOMS rooms stay resident — least-recently-used are evicted.
export const MESSAGE_WINDOW_SIZE = 200;
export const ROOM_CACHE_TRIM_SIZE = 50;
export const MAX_CACHED_ROOMS = 8;
export const PINNED_MESSAGES_LIMIT = 50;
export const TYPING_DEBOUNCE_MS = 2000;
export const TYPING_TIMEOUT_MS = 5000;
// Grace window to recall a just-sent message (undo send)
export const UNDO_SEND_WINDOW_MS = 8000;
// A sent message can only be edited within this window
export const EDIT_MESSAGE_WINDOW_MS = 60000;
// Debounce before persisting a draft to on-device storage
export const DRAFT_SAVE_DEBOUNCE_MS = 400;
// Upper bounds for album / poll composition
export const MAX_ALBUM_IMAGES = 10;
export const MAX_POLL_OPTIONS = 10;
// Presence: own heartbeat cadence + peer status refresh while a DM is open.
// Server counts a user online while last_active_at is within 75s.
export const PRESENCE_HEARTBEAT_MS = 45000;
export const PEER_PRESENCE_POLL_MS = 30000;

// Global search: debounce before hitting search_messages / search_profiles
export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_PAGE_SIZE = 20;

// Local app lock: failed-attempt lockout (brute-force slowdown)
export const APP_LOCK_MAX_ATTEMPTS = 5;
export const APP_LOCK_COOLDOWN_SECONDS = 30;
export const APP_LOCK_PIN_LENGTH = { min: 4, max: 6 } as const;

// Quick-reaction palette (minimal, no full emoji keyboard)
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
  FILE: "file",
  SYSTEM: "system",
  POLL: "poll",
} as const;

export const ROOM_TYPES = {
  DIRECT: "direct",
  GROUP: "group",
} as const;

export const USER_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  AWAY: "away",
} as const;

export const EAS_PROJECT_ID = "5ff3ce97-1320-44a7-b7f5-167bbfd02b6f";

// ============================================
// Incremental synchronization (Phase 4)
// ============================================

// Master flag. false ⇒ syncService.syncNow delegates to the legacy full
// fetch (reconnect → fetchMessages, foreground → fetchRooms), so behavior is
// byte-identical to today. Rollback is flipping this back to false.
export const FEATURE_DELTA_SYNC = true;
// A delta that returns this many rows is treated as "history diverged": we
// stop stitching and fall back to a fresh page-1 fetch (gap-overflow guard).
export const DELTA_SYNC_LIMIT = 200;
// Disk-history cap per room (prune older cached rows beyond this).
export const MAX_PERSISTED_PER_ROOM = 1000;
// Bounded exponential backoff for a failing delta sync (per scope).
export const DELTA_RETRY_BASE_MS = 2000;
export const DELTA_RETRY_MAX_MS = 30000;
export const DELTA_MAX_ATTEMPTS = 4;
// Reserved sync_state scope id for the room-list cursor (not a real room id).
export const ROOMS_SYNC_SCOPE = "@rooms";

// ============================================
// 1:1 Calling (WebRTC over Supabase Realtime signaling)
// ============================================

// Ring for this long before the outgoing call is marked missed
export const CALL_RING_TIMEOUT_MS = 35000;
// Connection-establishment guard: fail the call if media never connects
export const CALL_CONNECT_TIMEOUT_MS = 30000;

// Google public STUN + optional TURN (env-driven, TURN-ready by design).
// Provide EXPO_PUBLIC_TURN_URL/USERNAME/CREDENTIAL to add a relay for
// peers behind symmetric NATs; STUN-only still works for most networks.
export function getIceServers(): { urls: string | string[]; username?: string; credential?: string }[] {
  const servers: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrl = process.env.EXPO_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.EXPO_PUBLIC_TURN_USERNAME,
      credential: process.env.EXPO_PUBLIC_TURN_CREDENTIAL,
    });
  }

  return servers;
}

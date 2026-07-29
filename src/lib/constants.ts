export const MESSAGES_PER_PAGE = 20;
export const MEDIA_PER_PAGE = 30;
export const PINNED_MESSAGES_LIMIT = 50;
export const TYPING_DEBOUNCE_MS = 2000;
export const TYPING_TIMEOUT_MS = 5000;
// Grace window to recall a just-sent message (undo send)
export const UNDO_SEND_WINDOW_MS = 8000;
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

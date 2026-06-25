export const MESSAGES_PER_PAGE = 20;
export const TYPING_DEBOUNCE_MS = 2000;
export const TYPING_TIMEOUT_MS = 5000;

export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  FILE: "file",
  SYSTEM: "system",
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

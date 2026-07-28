export const MESSAGES_PER_PAGE = 20;
export const MEDIA_PER_PAGE = 30;
export const PINNED_MESSAGES_LIMIT = 50;
export const TYPING_DEBOUNCE_MS = 2000;
export const TYPING_TIMEOUT_MS = 5000;
// Grace window to recall a just-sent message (undo send)
export const UNDO_SEND_WINDOW_MS = 8000;

export const MESSAGE_TYPES = {
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
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

export const EAS_PROJECT_ID = "5ff3ce97-1320-44a7-b7f5-167bbfd02b6f";

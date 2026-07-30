import { FEATURE_SCROLL_TO_MESSAGE } from "@/src/lib/constants";

// Phase 11 §13. A module singleton that routes a jump request from ANY source
// (a reply bubble deep in the tree, the pinned sheet, a mention, a notification)
// to the mounted chat room's Scroll Manager — without prop-drilling a callback
// through MessageList → MessageBubble → ReplyContext. Only ONE chat room is ever
// mounted/foregrounded at a time, so a single registration slot is sufficient.
// Cross-room requests can't be served here (no live handler) — the caller
// navigates via the Phase 9 ?focus=&at= deep link instead.

export type JumpSource =
  | "search"
  | "reply"
  | "pinned"
  | "mention"
  | "notification"
  | "unread";

export interface JumpTarget {
  roomId: string;
  messageId: string;
  // Ordering key for around-loading + nearest-neighbour fallback. Optional: the
  // Scroll Manager resolves it from the resident row when omitted.
  createdAt?: string;
  source: JumpSource;
  // Whether to run the one-shot highlight on arrival (default true).
  highlight?: boolean;
}

export type JumpHandler = (target: JumpTarget) => void;

let current: { roomId: string; handler: JumpHandler } | null = null;

export const jumpBus = {
  register(roomId: string, handler: JumpHandler): void {
    current = { roomId, handler };
  },

  unregister(roomId: string): void {
    if (current?.roomId === roomId) current = null;
  },

  // Returns true when the request was dispatched to a mounted in-room handler;
  // false when the target room isn't mounted (the caller should navigate) or
  // the feature is off.
  request(target: JumpTarget): boolean {
    if (!FEATURE_SCROLL_TO_MESSAGE) return false;
    if (current && current.roomId === target.roomId) {
      current.handler(target);
      return true;
    }
    return false;
  },
};

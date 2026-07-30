import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewabilityConfig,
} from "react-native";
import type { FlashListRef, ViewToken } from "@shopify/flash-list";
import {
  ANCHOR_FLUSH_MS,
  FEATURE_SCROLL_RESTORE,
  MESSAGES_PER_PAGE,
  SCROLL_BOTTOM_THRESHOLD_PX,
} from "@/src/lib/constants";
import { cacheService } from "@/src/services/cacheService";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import {
  isRestorable,
  useScrollAnchorStore,
} from "@/src/stores/scrollAnchorStore";
import type { MessageWithMeta } from "@/src/types";

// Phase 9 §8. A search result (or future jump-to-reply) opens the room focused
// on a specific message rather than at the bottom.
export interface ScrollFocusTarget {
  messageId: string;
  createdAt: string;
}

// A live scroll-position candidate — the topmost visible message. Kept in a
// ref (never rendered) and flushed to the durable anchor store on a throttle /
// lifecycle edge (§2.1).
interface AnchorCandidate {
  messageId: string;
  createdAt: string;
  offsetRatio: number;
}

// Stable viewability config (identity must not change — FlashList forbids it).
const VIEWABILITY_CONFIG: ViewabilityConfig = {
  itemVisiblePercentThreshold: 10,
  minimumViewTime: 0,
  waitForInteraction: false,
};

// The messages array is newest-first (chatStore order); FlashList renders it
// reversed (chronological). Map a newest-first index to the rendered index.
function toRenderedIndex(total: number, newestFirstIndex: number): number {
  return total - 1 - newestFirstIndex;
}

// Newest message at-or-before `targetIso` (nearest-neighbour fallback, §3.5).
// messages are sorted created_at DESC, so the first row ≤ target wins.
function nearestNewestFirstIndex(
  messages: MessageWithMeta[],
  targetIso: string
): number {
  for (let i = 0; i < messages.length; i++) {
    const c = messages[i].created_at;
    if (c && c <= targetIso) return i;
  }
  return messages.length > 0 ? messages.length - 1 : -1;
}

// Resolve the first-render scroll index (§3.2 / §4.2): a focus target wins over
// the saved anchor. Returns undefined ⇒ render at the bottom (default), which is
// the common "was at bottom" case and every failure path (§10).
function resolveInitialIndex(
  messages: MessageWithMeta[],
  roomId: string,
  focus: ScrollFocusTarget | null
): number | undefined {
  const total = messages.length;
  if (total === 0) return undefined;

  const target = focus ?? (() => {
    const anchor = useScrollAnchorStore.getState().anchors[roomId];
    return isRestorable(anchor)
      ? { messageId: anchor.messageId, createdAt: anchor.createdAt }
      : null;
  })();
  if (!target) return undefined;

  const exact = messages.findIndex((m) => m.id === target.messageId);
  if (exact >= 0) return toRenderedIndex(total, exact);

  // Only the focus (explicit jump) uses the around-load swap to reach a target
  // outside the newest window (§8). A passive anchor that isn't resident simply
  // falls back to the bottom — no window surgery on a silent restore (§3.2).
  if (!focus) {
    const nn = nearestNewestFirstIndex(messages, target.createdAt);
    return nn >= 0 && nn < total - 1 ? toRenderedIndex(total, nn) : undefined;
  }
  return undefined;
}

/**
 * Phase 9 Scroll Manager — a non-reactive controller for one chat room.
 *
 * Owns the FlashList ref, the scroll-position candidate, the durable-flush
 * throttle, restore, and the search jump. Everything runs in refs so scroll
 * never re-renders the list (§9); only `showPill` is React state and only flips
 * on a bottom-crossing. Flag-off ⇒ inert: all handlers/props are undefined and
 * the list behaves exactly as today.
 */
export function useScrollManager(
  roomId: string,
  messages: MessageWithMeta[],
  focus: ScrollFocusTarget | null
) {
  const listRef = useRef<FlashListRef<MessageWithMeta>>(null);
  const [showPill, setShowPill] = useState(false);

  // Fresh reads for the stable callbacks below.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const showPillRef = useRef(false);
  const atBottomRef = useRef(true);
  const candidateRef = useRef<AnchorCandidate | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Guards a self-recording feedback loop while WE move the list (§2.7).
  const suppressRef = useRef(false);

  // First-render scroll index, resolved once when data first arrives (§4.2).
  const resolvedRef = useRef(false);
  const initialIndexRef = useRef<number | undefined>(undefined);
  if (FEATURE_SCROLL_RESTORE && !resolvedRef.current && messages.length > 0) {
    resolvedRef.current = true;
    initialIndexRef.current = resolveInitialIndex(messages, roomId, focus);
  }

  const setPill = useCallback((next: boolean) => {
    if (next === showPillRef.current) return;
    showPillRef.current = next;
    setShowPill(next);
  }, []);

  // Write the resting candidate durably (or clear it at the bottom). §2.1/§2.6.
  const flush = useCallback(() => {
    if (!FEATURE_SCROLL_RESTORE || suppressRef.current) return;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
    const store = useScrollAnchorStore.getState();
    const candidate = candidateRef.current;
    if (atBottomRef.current || !candidate) {
      store.clearAnchor(roomId);
      return;
    }
    store.setAnchor({
      roomId,
      messageId: candidate.messageId,
      createdAt: candidate.createdAt,
      offsetRatio: candidate.offsetRatio,
      updatedAt: Date.now(),
      atBottom: false,
    });
  }, [roomId]);

  const scrollToRenderedId = useCallback((id: string, animated: boolean) => {
    const msgs = messagesRef.current;
    const nfi = msgs.findIndex((m) => m.id === id);
    if (nfi < 0) return;
    listRef.current
      ?.scrollToIndex({
        index: toRenderedIndex(msgs.length, nfi),
        animated,
        viewPosition: 0.5,
      })
      .catch(() => {
        // Index briefly out of range during a data swap — safe to ignore.
      });
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!FEATURE_SCROLL_RESTORE) return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      const atBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX;
      const wasAtBottom = atBottomRef.current;
      atBottomRef.current = atBottom;
      setPill(!atBottom && messagesRef.current.length > 0);

      if (atBottom) {
        // Crossing into the bottom = "caught up": drop the anchor + unread.
        if (!wasAtBottom && !suppressRef.current) {
          useScrollAnchorStore.getState().clearAnchor(roomId);
          useRoomStore.getState().clearUnread(roomId);
          candidateRef.current = null;
        }
        return;
      }
      // Reading history: trailing-throttle a durable write (§2.1/§2.2).
      if (!flushTimerRef.current) {
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = undefined;
          flush();
        }, ANCHOR_FLUSH_MS);
      }
    },
    [roomId, flush, setPill]
  );

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken<MessageWithMeta>[] }) => {
      if (!FEATURE_SCROLL_RESTORE) return;
      const items = info.viewableItems;
      if (items.length === 0) return;
      // Rendered data is chronological; the first viewable row is the topmost.
      const top = items[0]?.item;
      if (!top || top.id.startsWith("temp-")) return;
      candidateRef.current = {
        messageId: top.id,
        createdAt: top.created_at ?? new Date().toISOString(),
        offsetRatio: 0,
      };
    },
    []
  );

  // Pill tap / caught-up: snap to the newest message and clear state (§5.4).
  const scrollToBottom = useCallback(() => {
    suppressRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
    atBottomRef.current = true;
    setPill(false);
    useScrollAnchorStore.getState().clearAnchor(roomId);
    useRoomStore.getState().clearUnread(roomId);
    candidateRef.current = null;
    setTimeout(() => {
      suppressRef.current = false;
    }, 400);
  }, [roomId, setPill]);

  // Show the pill straight after a non-bottom restore (before any user scroll).
  useEffect(() => {
    if (!FEATURE_SCROLL_RESTORE) return;
    if (messages.length === 0) return;
    const idx = initialIndexRef.current;
    if (idx != null && idx < messages.length - 1) {
      atBottomRef.current = false;
      setPill(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Search jump (§8): bring the focus target into the window if it's outside
  // the newest page, then animate to it. Runs once per focus target.
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (!FEATURE_SCROLL_RESTORE || !focus) return;
    if (jumpedRef.current || messages.length === 0) return;
    jumpedRef.current = true;

    if (messages.some((m) => m.id === focus.messageId)) {
      atBottomRef.current = false;
      setPill(true);
      requestAnimationFrame(() => scrollToRenderedId(focus.messageId, true));
      return;
    }

    // Target is older than the resident window — swap in an around-window from
    // the cache (§3.3) then jump. Best-effort: an empty result leaves the room
    // at the bottom (graceful fallback, §10).
    suppressRef.current = true;
    cacheService
      .getRoomMessagesAround(roomId, focus.createdAt, MESSAGES_PER_PAGE)
      .then((windowRows) => {
        if (windowRows.length === 0) {
          suppressRef.current = false;
          return;
        }
        useChatStore.getState().setRoomMessages(roomId, windowRows);
        atBottomRef.current = false;
        setPill(true);
        requestAnimationFrame(() => {
          scrollToRenderedId(focus.messageId, true);
          setTimeout(() => {
            suppressRef.current = false;
          }, 500);
        });
      })
      .catch(() => {
        suppressRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, messages.length, focus?.messageId]);

  // Force a final flush when the app backgrounds — the OS may kill us with no
  // further JS, so the position must be durable at the transition (§2.3).
  useEffect(() => {
    if (!FEATURE_SCROLL_RESTORE) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") flush();
    });
    return () => sub.remove();
  }, [flush]);

  // Force a final flush on room switch / leave (§2.4/§2.5).
  useEffect(() => {
    return () => {
      if (!FEATURE_SCROLL_RESTORE) return;
      flush();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [flush]);

  // Flag-off ⇒ everything inert so <MessageList> renders exactly as today.
  if (!FEATURE_SCROLL_RESTORE) {
    return {
      listRef,
      initialScrollIndex: undefined as number | undefined,
      onScroll: undefined,
      onViewableItemsChanged: undefined,
      viewabilityConfig: undefined,
      showPill: false,
      scrollToBottom: () => {},
    };
  }

  return {
    listRef,
    initialScrollIndex: initialIndexRef.current,
    onScroll,
    onViewableItemsChanged,
    viewabilityConfig: VIEWABILITY_CONFIG,
    showPill,
    scrollToBottom,
  };
}

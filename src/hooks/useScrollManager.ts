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
  FEATURE_SCROLL_TO_MESSAGE,
  JUMP_HIGHLIGHT_DURATION_MS,
  JUMP_LOAD_TIMEOUT_MS,
  JUMP_WINDOW_RADIUS,
  MESSAGES_PER_PAGE,
  SCROLL_BOTTOM_THRESHOLD_PX,
} from "@/src/lib/constants";
import { cacheService } from "@/src/services/cacheService";
import { messageService } from "@/src/services/messageService";
import { jumpBus, type JumpTarget } from "@/src/lib/jumpBus";
import { useChatStore } from "@/src/stores/chatStore";
import { useJumpStore, type JumpReturnAnchor } from "@/src/stores/jumpStore";
import { useRoomStore } from "@/src/stores/roomStore";
import {
  isRestorable,
  useScrollAnchorStore,
} from "@/src/stores/scrollAnchorStore";
import type { MessageWithMeta } from "@/src/types";

// Phase 11: the scroll machinery (refs, handlers, candidate tracking) activates
// when EITHER scroll restoration or scroll-to-message is on; only the durable
// anchor writes stay gated on FEATURE_SCROLL_RESTORE. Both off ⇒ fully inert.
const SCROLL_ACTIVE = FEATURE_SCROLL_RESTORE || FEATURE_SCROLL_TO_MESSAGE;

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

// Reject after `ms` so a slow server around-fetch degrades to the fallback (§14).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("jump-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

  const target = focus ?? (FEATURE_SCROLL_RESTORE
    ? (() => {
        const anchor = useScrollAnchorStore.getState().anchors[roomId];
        return isRestorable(anchor)
          ? { messageId: anchor.messageId, createdAt: anchor.createdAt }
          : null;
      })()
    : null);
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
  if (SCROLL_ACTIVE && !resolvedRef.current && messages.length > 0) {
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
      if (!SCROLL_ACTIVE) return;
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
      if (!SCROLL_ACTIVE) return;
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

  // ————————————————————————————————————————————————————————————————
  // Phase 11 — jump pipeline (§3/§13). One scheduler slot: a new request
  // supersedes any in-flight jump via a generation counter, so overlapping taps
  // never fight (I-J6). Everything below is gated on FEATURE_SCROLL_TO_MESSAGE.
  // ————————————————————————————————————————————————————————————————
  const jumpGenRef = useRef(0);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // One-shot highlight (§7): publish the target + a fresh token, then auto-clear.
  const triggerHighlight = useCallback(
    (messageId: string) => {
      if (!FEATURE_SCROLL_TO_MESSAGE) return;
      useJumpStore.getState().setHighlight(roomId, messageId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        useJumpStore.getState().clearHighlight(roomId);
      }, JUMP_HIGHLIGHT_DURATION_MS);
    },
    [roomId]
  );

  // Where the viewport is right now — captured before a jump so the return chip
  // can undo it (§8). "bottom" when pinned to the newest message.
  const captureReturnAnchor = useCallback((): JumpReturnAnchor => {
    if (atBottomRef.current) return "bottom";
    const c = candidateRef.current;
    return c ? { messageId: c.messageId, createdAt: c.createdAt } : "bottom";
  }, []);

  // Center the current list on a resident id; returns whether it was found.
  const scrollToResidentId = useCallback((id: string): boolean => {
    const msgs = messagesRef.current;
    const nfi = msgs.findIndex((m) => m.id === id);
    if (nfi < 0) return false;
    listRef.current
      ?.scrollToIndex({
        index: toRenderedIndex(msgs.length, nfi),
        animated: false,
        viewPosition: 0.5,
      })
      .catch(() => {});
    return true;
  }, []);

  // The core pipeline (§3): resolve → resident? → cache around → server around →
  // nearest-neighbour → bottom. `isReturn` skips pushing a new history entry.
  const runJump = useCallback(
    async (target: JumpTarget, isReturn = false) => {
      if (!FEATURE_SCROLL_TO_MESSAGE) return;
      // Optimistic/temporary rows are never a jump target (I-J9).
      if (target.messageId.startsWith("temp-")) return;

      const gen = ++jumpGenRef.current;
      const msgs = messagesRef.current;

      // Resolve the ordering key from the resident row when the caller omits it.
      let at = target.createdAt;
      if (!at) {
        at = msgs.find((m) => m.id === target.messageId)?.created_at ?? undefined;
      }

      const fromAnchor = captureReturnAnchor();
      const wantHighlight = target.highlight !== false;

      // Center on the target once the (possibly swapped) window has committed;
      // fall back to nearest-neighbour by time when the id isn't present (§14).
      const land = () => {
        requestAnimationFrame(() => {
          if (gen !== jumpGenRef.current) return;
          if (scrollToResidentId(target.messageId)) {
            if (wantHighlight) triggerHighlight(target.messageId);
          } else if (at) {
            const nn = nearestNewestFirstIndex(messagesRef.current, at);
            if (nn >= 0) {
              listRef.current
                ?.scrollToIndex({
                  index: toRenderedIndex(messagesRef.current.length, nn),
                  animated: false,
                  viewPosition: 0.5,
                })
                .catch(() => {});
            }
          }
          setTimeout(() => {
            if (gen === jumpGenRef.current) suppressRef.current = false;
          }, 500);
        });
      };

      // 1. Resident — no data movement, instant centered scroll (§4.1).
      if (msgs.some((m) => m.id === target.messageId)) {
        atBottomRef.current = false;
        setPill(true);
        if (!isReturn) useJumpStore.getState().pushHistory(roomId, fromAnchor);
        suppressRef.current = true;
        land();
        return;
      }

      // Need a window; without an ordering key we can't around-load — bail (§4).
      if (!at) return;

      suppressRef.current = true;
      let windowRows: MessageWithMeta[] = [];
      try {
        windowRows = await cacheService.getRoomMessagesAround(
          roomId,
          at,
          JUMP_WINDOW_RADIUS
        );
      } catch {
        windowRows = [];
      }
      if (gen !== jumpGenRef.current) return;

      let found = windowRows.some((m) => m.id === target.messageId);

      // 2. Cache missed the target row → bounded server around-fetch (§5.1).
      if (!found) {
        try {
          const serverRows = await withTimeout(
            messageService.getMessagesAround(roomId, at, JUMP_WINDOW_RADIUS),
            JUMP_LOAD_TIMEOUT_MS
          );
          if (gen !== jumpGenRef.current) return;
          if (serverRows.length > 0) {
            cacheService.saveMessages(serverRows); // write-through
            windowRows = serverRows;
            found = serverRows.some((m) => m.id === target.messageId);
          }
        } catch {
          // Offline / timeout → fall through with whatever the cache gave us.
        }
      }
      if (gen !== jumpGenRef.current) return;

      if (windowRows.length === 0) {
        // Nothing to show anywhere — stay put (§14).
        suppressRef.current = false;
        return;
      }

      // Swap the resident window to the around-window, then land on the target.
      useChatStore.getState().setRoomMessages(roomId, windowRows);
      atBottomRef.current = false;
      setPill(true);
      if (!isReturn) useJumpStore.getState().pushHistory(roomId, fromAnchor);
      void found; // presence already reflected in the swapped window
      land();
    },
    [roomId, captureReturnAnchor, scrollToResidentId, setPill, triggerHighlight]
  );

  // Stable bus handler: register once per room, always calling the latest runJump.
  const runJumpRef = useRef(runJump);
  runJumpRef.current = runJump;

  useEffect(() => {
    if (!FEATURE_SCROLL_TO_MESSAGE) return;
    jumpBus.register(roomId, (target) => runJumpRef.current(target));
    return () => {
      jumpBus.unregister(roomId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      useJumpStore.getState().clearHighlight(roomId);
    };
  }, [roomId]);

  // Return chip (§8): pop the trail and go back to where the user was.
  const returnToPrevious = useCallback(() => {
    if (!FEATURE_SCROLL_TO_MESSAGE) return;
    const entry = useJumpStore.getState().popHistory(roomId);
    if (!entry) return;
    if (entry.anchor === "bottom") {
      scrollToBottom();
      return;
    }
    void runJump(
      {
        roomId,
        messageId: entry.anchor.messageId,
        createdAt: entry.anchor.createdAt,
        source: "unread",
        highlight: false,
      },
      true
    );
  }, [roomId, runJump, scrollToBottom]);

  // Show the pill straight after a non-bottom restore (before any user scroll).
  useEffect(() => {
    if (!SCROLL_ACTIVE) return;
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
    if (!SCROLL_ACTIVE || !focus) return;
    if (jumpedRef.current || messages.length === 0) return;
    jumpedRef.current = true;

    if (messages.some((m) => m.id === focus.messageId)) {
      atBottomRef.current = false;
      setPill(true);
      requestAnimationFrame(() => {
        scrollToRenderedId(focus.messageId, true);
        triggerHighlight(focus.messageId);
      });
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
          triggerHighlight(focus.messageId);
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
  if (!SCROLL_ACTIVE) {
    return {
      listRef,
      initialScrollIndex: undefined as number | undefined,
      onScroll: undefined,
      onViewableItemsChanged: undefined,
      viewabilityConfig: undefined,
      showPill: false,
      scrollToBottom: () => {},
      returnToPrevious: () => {},
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
    returnToPrevious,
  };
}

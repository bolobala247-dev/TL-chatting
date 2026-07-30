import { create } from "zustand";
import type {
  Message,
  MessageWithMeta,
  RoomParticipant,
  RoomParticipantWithProfile,
} from "@/src/types";
import { messageService } from "@/src/services/messageService";
import { cacheService } from "@/src/services/cacheService";
import {
  MESSAGES_PER_PAGE,
  MESSAGE_WINDOW_SIZE,
  ROOM_CACHE_TRIM_SIZE,
  MAX_CACHED_ROOMS,
} from "@/src/lib/constants";

type ReactionPatch = { user_id: string; emoji: string };
type VotePatch = { user_id: string; option_index: number };

interface ChatState {
  messages: Record<string, MessageWithMeta[]>;
  // Per-room loading so pagination in one room never blocks another
  loadingByRoom: Record<string, boolean>;
  hasMore: Record<string, boolean>;
  activeRoomId: string | null;
  // Participants cached per room: header + read-receipt watermarks
  participantsByRoom: Record<string, RoomParticipantWithProfile[]>;

  setActiveRoom: (roomId: string | null) => void;
  fetchMessages: (roomId: string, cursor?: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (messageId: string, roomId: string) => void;
  addOptimisticMessage: (message: MessageWithMeta) => void;
  replaceOptimisticMessage: (tempId: string, message: Message) => void;
  // Dumb setter for the incremental-sync path (Phase 4): syncService merges
  // the server delta (repository-owned merge) then hands back the finished
  // window. The store just swaps the array — no merge logic lives here.
  setRoomMessages: (roomId: string, rows: MessageWithMeta[]) => void;
  applyReactionChange: (
    roomId: string,
    messageId: string,
    reaction: ReactionPatch,
    kind: "add" | "remove"
  ) => void;
  applyVoteChange: (
    roomId: string,
    messageId: string,
    vote: VotePatch,
    kind: "add" | "remove"
  ) => void;
  setRoomParticipants: (
    roomId: string,
    participants: RoomParticipantWithProfile[]
  ) => void;
  applyParticipantUpdate: (participant: RoomParticipant) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Module-level (non-reactive) bookkeeping — no component ever renders from it.
// ---------------------------------------------------------------------------

// In-flight fetch dedup, keyed `${roomId}|${cursor}`. Lets the room list
// prefetch page 1 on press without racing the mount fetch into a duplicate
// request. Only *concurrent* requests dedup — a completed fetch never blocks
// a fresh one, so no realtime gap can hide behind a stale skip.
const inFlightFetches = new Set<string>();

// LRU recency stamps per room, used to pick eviction victims.
const lruStamp = new Map<string, number>();

// Immutably replaces one room's message array (shared patch helper).
function withRoomMessages(
  state: ChatState,
  roomId: string,
  rows: MessageWithMeta[]
): Pick<ChatState, "messages"> {
  return { messages: { ...state.messages, [roomId]: rows } };
}

// Immutably patches a single cached message; returns the state untouched
// when the message isn't in memory (realtime event for an evicted room).
function withPatchedMessage(
  state: ChatState,
  roomId: string,
  messageId: string,
  patch: (m: MessageWithMeta) => MessageWithMeta
): ChatState | Pick<ChatState, "messages"> {
  const roomMessages = state.messages[roomId] ?? [];
  if (!roomMessages.some((m) => m.id === messageId)) return state;
  return withRoomMessages(
    state,
    roomId,
    roomMessages.map((m) => (m.id === messageId ? patch(m) : m))
  );
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  loadingByRoom: {},
  hasMore: {},
  activeRoomId: null,
  participantsByRoom: {},

  // Besides switching the active room, this is where the bounded cache is
  // enforced: the room being left is trimmed to its re-open window and
  // least-recently-used rooms beyond MAX_CACHED_ROOMS are evicted. Both are
  // safe because a room mount always refetches page 1 (fetchMessages without
  // cursor replaces the array), so trimmed history never survives a re-open.
  setActiveRoom: (roomId) => {
    if (roomId) lruStamp.set(roomId, Date.now());

    set((state) => {
      const prev = state.activeRoomId;
      let messages = state.messages;
      let hasMore = state.hasMore;
      let loadingByRoom = state.loadingByRoom;
      let participantsByRoom = state.participantsByRoom;

      // Trim the room we're leaving — never the active one, so trimming can
      // never yank rows out from under maintainVisibleContentPosition.
      if (prev && prev !== roomId) {
        const rows = messages[prev];
        if (rows && rows.length > ROOM_CACHE_TRIM_SIZE) {
          messages = {
            ...messages,
            [prev]: rows.slice(0, ROOM_CACHE_TRIM_SIZE),
          };
          // Older pages were dropped — pagination must refetch them
          hasMore = { ...hasMore, [prev]: true };
        }
      }

      // Evict coldest rooms above the cap (the new active room is exempt).
      const cached = Object.keys(messages);
      if (cached.length > MAX_CACHED_ROOMS) {
        const victims = cached
          .filter((id) => id !== roomId)
          .sort((a, b) => (lruStamp.get(a) ?? 0) - (lruStamp.get(b) ?? 0))
          .slice(0, cached.length - MAX_CACHED_ROOMS);
        if (victims.length > 0) {
          messages = { ...messages };
          hasMore = { ...hasMore };
          loadingByRoom = { ...loadingByRoom };
          participantsByRoom = { ...participantsByRoom };
          for (const id of victims) {
            delete messages[id];
            delete hasMore[id];
            delete loadingByRoom[id];
            delete participantsByRoom[id];
            lruStamp.delete(id);
          }
        }
      }

      return {
        activeRoomId: roomId,
        messages,
        hasMore,
        loadingByRoom,
        participantsByRoom,
      };
    });
  },

  fetchMessages: async (roomId, cursor) => {
    const flightKey = `${roomId}|${cursor ?? ""}`;
    if (inFlightFetches.has(flightKey)) return;
    inFlightFetches.add(flightKey);

    // Hydrate-first (Phase 3, page 1 only): a room with no rows in RAM
    // paints its newest cached window immediately, replacing the full-screen
    // spinner. The network page below stays authoritative — it replaces the
    // hydrated rows when it lands. SQLite feeds the store, never the UI.
    if (!cursor && (get().messages[roomId] ?? []).length === 0) {
      void cacheService
        .getRoomMessages(roomId, MESSAGES_PER_PAGE)
        .then((cached) => {
          if (cached.length === 0) return;
          set((state) => {
            // The network page (or an optimistic send) may have landed
            // first — cached rows never overwrite fresher in-memory data
            if ((state.messages[roomId] ?? []).length > 0) return state;
            return withRoomMessages(state, roomId, cached);
          });
        });
    }

    set((state) => ({
      loadingByRoom: { ...state.loadingByRoom, [roomId]: true },
    }));
    try {
      const newMessages = await messageService.getMessages(roomId, cursor);
      set((state) => {
        const existing = cursor ? (state.messages[roomId] ?? []) : [];
        const merged = [...existing, ...newMessages];
        const unique = Array.from(
          new Map(merged.map((m) => [m.id, m])).values()
        );
        // Parse each timestamp once (not per comparison) before sorting
        const timeById = new Map(
          unique.map((m) => [m.id, new Date(m.created_at ?? 0).getTime()])
        );
        unique.sort((a, b) => timeById.get(b.id)! - timeById.get(a.id)!);

        return {
          ...withRoomMessages(state, roomId, unique),
          hasMore: {
            ...state.hasMore,
            [roomId]: newMessages.length >= MESSAGES_PER_PAGE,
          },
          loadingByRoom: { ...state.loadingByRoom, [roomId]: false },
        };
      });
      // Write-through (fire-and-forget): page 1 refreshes the newest cached
      // window; older pages extend the cached history
      if (cursor) {
        cacheService.saveMessages(newMessages);
      } else {
        cacheService.saveMessagePage(roomId, newMessages);
      }
    } catch {
      set((state) => ({
        loadingByRoom: { ...state.loadingByRoom, [roomId]: false },
      }));
    } finally {
      inFlightFetches.delete(flightKey);
    }
  },

  addMessage: (message) => {
    set((state) => {
      const roomMessages = state.messages[message.room_id] ?? [];
      if (roomMessages.some((m) => m.id === message.id)) {
        return state;
      }
      const next = [message, ...roomMessages];
      // Bounded window on realtime inserts: inactive rooms stay at the
      // re-open size; the active room only sheds rows past the hard ceiling
      // (reachable only after ~10 pagination pages — accepted tradeoff).
      const cap =
        state.activeRoomId === message.room_id
          ? MESSAGE_WINDOW_SIZE
          : ROOM_CACHE_TRIM_SIZE;
      if (next.length <= cap) {
        return withRoomMessages(state, message.room_id, next);
      }
      return {
        ...withRoomMessages(state, message.room_id, next.slice(0, cap)),
        // Dropped rows are server-side history — pagination can refetch
        hasMore: { ...state.hasMore, [message.room_id]: true },
      };
    });
    // Write-through: realtime inserts survive restarts even for rooms
    // that were never opened in this session
    cacheService.saveMessages([message]);
  },

  updateMessage: (message) => {
    set((state) =>
      withPatchedMessage(state, message.room_id, message.id, (m) => ({
        ...message,
        // Realtime UPDATE payloads carry no embeds: keep local meta
        message_reactions: m.message_reactions,
        poll_votes: m.poll_votes,
      }))
    );
    // Persist the merged row (with its meta) when the message is windowed;
    // fall back to the raw payload for rooms not resident in RAM
    const patched = get()
      .messages[message.room_id]?.find((m) => m.id === message.id);
    cacheService.saveMessages([patched ?? message]);
  },

  removeMessage: (messageId, roomId) => {
    set((state) => {
      const roomMessages = state.messages[roomId] ?? [];
      return withRoomMessages(
        state,
        roomId,
        roomMessages.filter((m) => m.id !== messageId)
      );
    });
    // Hard deletes leave the cache too (temp- ids are ignored inside)
    cacheService.deleteMessage(messageId);
  },

  addOptimisticMessage: (message) => {
    set((state) =>
      withRoomMessages(state, message.room_id, [
        message,
        ...(state.messages[message.room_id] ?? []),
      ])
    );
  },

  replaceOptimisticMessage: (tempId, message) => {
    set((state) => {
      const roomMessages = state.messages[message.room_id] ?? [];
      // Realtime INSERT may have already delivered the real message:
      // drop the temp copy instead of creating a duplicate id
      if (roomMessages.some((m) => m.id === message.id)) {
        return withRoomMessages(
          state,
          message.room_id,
          roomMessages.filter((m) => m.id !== tempId)
        );
      }
      return withRoomMessages(
        state,
        message.room_id,
        roomMessages.map((m) => (m.id === tempId ? message : m))
      );
    });
    // The send is confirmed server-side — safe to persist (upsert dedups
    // against the realtime echo)
    cacheService.saveMessages([message]);
  },

  // Swap in the already-merged window from the incremental-sync path. The
  // merge (dedup, server-wins, meta-preserve, sort, cap) has already happened
  // in the repository layer via cacheService.mergeMessages — this only writes
  // the finished array into RAM so the list re-renders.
  setRoomMessages: (roomId, rows) => {
    set((state) => withRoomMessages(state, roomId, rows));
  },

  applyReactionChange: (roomId, messageId, reaction, kind) => {
    set((state) =>
      withPatchedMessage(state, roomId, messageId, (m) => {
        const current = m.message_reactions ?? [];
        // Dedup by user+emoji so optimistic + realtime echo don't double
        const without = current.filter(
          (r) =>
            !(r.user_id === reaction.user_id && r.emoji === reaction.emoji)
        );
        return {
          ...m,
          message_reactions: kind === "add" ? [...without, reaction] : without,
        };
      })
    );
    // Keep the cached row's embeds current (optimistic reverts re-persist,
    // so a failed toggle self-corrects on disk as well)
    const patched = get().messages[roomId]?.find((m) => m.id === messageId);
    if (patched) cacheService.saveMessages([patched]);
  },

  applyVoteChange: (roomId, messageId, vote, kind) => {
    set((state) =>
      withPatchedMessage(state, roomId, messageId, (m) => {
        // Single choice: any change replaces the user's previous vote
        const without = (m.poll_votes ?? []).filter(
          (v) => v.user_id !== vote.user_id
        );
        return {
          ...m,
          poll_votes: kind === "add" ? [...without, vote] : without,
        };
      })
    );
    const patched = get().messages[roomId]?.find((m) => m.id === messageId);
    if (patched) cacheService.saveMessages([patched]);
  },

  setRoomParticipants: (roomId, participants) => {
    set((state) => ({
      participantsByRoom: {
        ...state.participantsByRoom,
        [roomId]: participants,
      },
    }));
  },

  // Realtime watermark update (last_read_at) → live read receipts
  applyParticipantUpdate: (participant) => {
    set((state) => {
      const roomParticipants = state.participantsByRoom[participant.room_id];
      if (!roomParticipants) return state;

      return {
        participantsByRoom: {
          ...state.participantsByRoom,
          [participant.room_id]: roomParticipants.map((p) =>
            p.user_id === participant.user_id
              ? { ...p, ...participant, profiles: p.profiles }
              : p
          ),
        },
      };
    });
  },

  reset: () => {
    inFlightFetches.clear();
    lruStamp.clear();
    set({
      messages: {},
      loadingByRoom: {},
      hasMore: {},
      activeRoomId: null,
      participantsByRoom: {},
    });
  },
}));

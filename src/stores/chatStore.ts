import { create } from "zustand";
import type {
  Message,
  MessageWithMeta,
  RoomParticipant,
  RoomParticipantWithProfile,
} from "@/src/types";
import { messageService } from "@/src/services/messageService";
import { MESSAGES_PER_PAGE } from "@/src/lib/constants";

type ReactionPatch = { user_id: string; emoji: string };
type VotePatch = { user_id: string; option_index: number };

interface ChatState {
  messages: Record<string, MessageWithMeta[]>;
  loading: boolean;
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

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  loading: false,
  hasMore: {},
  activeRoomId: null,
  participantsByRoom: {},

  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),

  fetchMessages: async (roomId, cursor) => {
    set({ loading: true });
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
          messages: { ...state.messages, [roomId]: unique },
          hasMore: {
            ...state.hasMore,
            [roomId]: newMessages.length >= MESSAGES_PER_PAGE,
          },
          loading: false,
        };
      });
    } catch {
      set({ loading: false });
    }
  },

  addMessage: (message) => {
    set((state) => {
      const roomMessages = state.messages[message.room_id] ?? [];
      if (roomMessages.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [message.room_id]: [message, ...roomMessages],
        },
      };
    });
  },

  updateMessage: (message) => {
    set((state) => {
      const roomMessages = state.messages[message.room_id] ?? [];
      return {
        messages: {
          ...state.messages,
          [message.room_id]: roomMessages.map((m) =>
            m.id === message.id
              ? // Realtime UPDATE payloads carry no embeds: keep local meta
                {
                  ...message,
                  message_reactions: m.message_reactions,
                  poll_votes: m.poll_votes,
                }
              : m
          ),
        },
      };
    });
  },

  removeMessage: (messageId, roomId) => {
    set((state) => {
      const roomMessages = state.messages[roomId] ?? [];
      return {
        messages: {
          ...state.messages,
          [roomId]: roomMessages.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  addOptimisticMessage: (message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [message.room_id]: [
          message,
          ...(state.messages[message.room_id] ?? []),
        ],
      },
    }));
  },

  replaceOptimisticMessage: (tempId, message) => {
    set((state) => {
      const roomMessages = state.messages[message.room_id] ?? [];
      // Realtime INSERT may have already delivered the real message:
      // drop the temp copy instead of creating a duplicate id
      if (roomMessages.some((m) => m.id === message.id)) {
        return {
          messages: {
            ...state.messages,
            [message.room_id]: roomMessages.filter((m) => m.id !== tempId),
          },
        };
      }
      return {
        messages: {
          ...state.messages,
          [message.room_id]: roomMessages.map((m) =>
            m.id === tempId ? message : m
          ),
        },
      };
    });
  },

  applyReactionChange: (roomId, messageId, reaction, kind) => {
    set((state) => {
      const roomMessages = state.messages[roomId] ?? [];
      if (!roomMessages.some((m) => m.id === messageId)) return state;

      return {
        messages: {
          ...state.messages,
          [roomId]: roomMessages.map((m) => {
            if (m.id !== messageId) return m;
            const current = m.message_reactions ?? [];
            // Dedup by user+emoji so optimistic + realtime echo don't double
            const without = current.filter(
              (r) =>
                !(r.user_id === reaction.user_id && r.emoji === reaction.emoji)
            );
            return {
              ...m,
              message_reactions:
                kind === "add" ? [...without, reaction] : without,
            };
          }),
        },
      };
    });
  },

  applyVoteChange: (roomId, messageId, vote, kind) => {
    set((state) => {
      const roomMessages = state.messages[roomId] ?? [];
      if (!roomMessages.some((m) => m.id === messageId)) return state;

      return {
        messages: {
          ...state.messages,
          [roomId]: roomMessages.map((m) => {
            if (m.id !== messageId) return m;
            // Single choice: any change replaces the user's previous vote
            const without = (m.poll_votes ?? []).filter(
              (v) => v.user_id !== vote.user_id
            );
            return {
              ...m,
              poll_votes: kind === "add" ? [...without, vote] : without,
            };
          }),
        },
      };
    });
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

  reset: () =>
    set({
      messages: {},
      loading: false,
      hasMore: {},
      activeRoomId: null,
      participantsByRoom: {},
    }),
}));

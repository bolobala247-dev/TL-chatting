import { create } from "zustand";
import type { Message } from "@/src/types";
import { messageService } from "@/src/services/messageService";

interface ChatState {
  messages: Record<string, Message[]>;
  loading: boolean;
  hasMore: Record<string, boolean>;
  activeRoomId: string | null;

  setActiveRoom: (roomId: string | null) => void;
  fetchMessages: (roomId: string, cursor?: string) => Promise<void>;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  removeMessage: (messageId: string, roomId: string) => void;
  addOptimisticMessage: (message: Message) => void;
  replaceOptimisticMessage: (tempId: string, message: Message) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  loading: false,
  hasMore: {},
  activeRoomId: null,

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
        unique.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        return {
          messages: { ...state.messages, [roomId]: unique },
          hasMore: {
            ...state.hasMore,
            [roomId]: newMessages.length >= 20,
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
            m.id === message.id ? message : m
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

  reset: () =>
    set({ messages: {}, loading: false, hasMore: {}, activeRoomId: null }),
}));

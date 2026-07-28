import { useEffect } from "react";
import { AppState } from "react-native";
import { supabase } from "@/src/lib/supabase";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  Message,
  MessageReaction,
  PollVote,
  RoomParticipant,
} from "@/src/types";

const RESUBSCRIBE_DELAY_MS = 3000;

// Cache sender names for room list previews (audit P14)
const senderNameCache = new Map<string, string>();

async function resolveSenderName(
  senderId: string,
  currentUserId: string
): Promise<string | null> {
  if (senderId === currentUserId) {
    const profile = useAuthStore.getState().profile;
    return profile?.display_name || profile?.username || null;
  }

  const cached = senderNameCache.get(senderId);
  if (cached) return cached;

  const { data } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", senderId)
    .maybeSingle();

  const name = data?.display_name || data?.username || null;
  if (name) senderNameCache.set(senderId, name);
  return name;
}

export function useRealtimeMessages(roomId: string) {
  useEffect(() => {
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hadDrop = false;

    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (disposed) return;
        if (channel) supabase.removeChannel(channel);
        connect();
      }, RESUBSCRIBE_DELAY_MS);
    };

    const connect = () => {
      if (disposed) return;

      channel = supabase
        .channel(`room:${roomId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            useChatStore.getState().addMessage(payload.new as Message);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            useChatStore.getState().updateMessage(payload.new as Message);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "messages",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            useChatStore
              .getState()
              .removeMessage((payload.old as any).id, roomId);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "message_reactions",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const reaction = payload.new as MessageReaction;
            useChatStore
              .getState()
              .applyReactionChange(
                roomId,
                reaction.message_id,
                { user_id: reaction.user_id, emoji: reaction.emoji },
                "add"
              );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "message_reactions",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            // REPLICA IDENTITY FULL: old row carries all columns
            const reaction = payload.old as MessageReaction;
            useChatStore
              .getState()
              .applyReactionChange(
                roomId,
                reaction.message_id,
                { user_id: reaction.user_id, emoji: reaction.emoji },
                "remove"
              );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "poll_votes",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const vote = payload.new as PollVote;
            useChatStore
              .getState()
              .applyVoteChange(
                roomId,
                vote.message_id,
                { user_id: vote.user_id, option_index: vote.option_index },
                "add"
              );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "poll_votes",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            // Vote change (upsert): 'add' replaces the user's previous vote
            const vote = payload.new as PollVote;
            useChatStore
              .getState()
              .applyVoteChange(
                roomId,
                vote.message_id,
                { user_id: vote.user_id, option_index: vote.option_index },
                "add"
              );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "poll_votes",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            const vote = payload.old as PollVote;
            useChatStore
              .getState()
              .applyVoteChange(
                roomId,
                vote.message_id,
                { user_id: vote.user_id, option_index: vote.option_index },
                "remove"
              );
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "room_participants",
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            // last_read_at watermark moved → live read receipts
            useChatStore
              .getState()
              .applyParticipantUpdate(payload.new as RoomParticipant);
          }
        )
        .subscribe((status) => {
          if (disposed) return;

          if (status === "SUBSCRIBED") {
            if (hadDrop) {
              // Refetch latest page to recover messages missed while offline
              hadDrop = false;
              void useChatStore.getState().fetchMessages(roomId);
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            hadDrop = true;
            scheduleReconnect();
          }
        });
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId]);
}

export function useRealtimeRooms() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let hadDrop = false;

    const resync = () => {
      void useRoomStore.getState().fetchRooms(userId);
    };

    const handleNewMessage = (message: Message) => {
      const roomStore = useRoomStore.getState();

      // Room not in local state yet (brand-new conversation): full refetch
      if (!roomStore.rooms.some((r) => r.room_id === message.room_id)) {
        resync();
        return;
      }

      // activeRoomId read at event time to avoid stale-closure increments
      const activeRoomId = useChatStore.getState().activeRoomId;
      if (message.sender_id !== userId && message.room_id !== activeRoomId) {
        roomStore.incrementUnread(message.room_id);
      }

      void resolveSenderName(message.sender_id, userId)
        .catch(() => null)
        .then((senderName) => {
          useRoomStore
            .getState()
            .updateRoomLastMessage(
              message.room_id,
              message.content,
              senderName,
              message.created_at ?? new Date().toISOString(),
              message.type
            );
        });
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (disposed) return;
        if (channel) supabase.removeChannel(channel);
        connect();
      }, RESUBSCRIBE_DELAY_MS);
    };

    const connect = () => {
      if (disposed) return;

      channel = supabase
        .channel("global:messages")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
          },
          (payload) => {
            handleNewMessage(payload.new as Message);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "room_participants",
          },
          () => {
            // Membership changed (added to a room): refetch list
            resync();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "room_participants",
          },
          () => {
            resync();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "room_participants",
          },
          (payload) => {
            // Only own last_read updates matter: sync read state across
            // this user's devices without refetching everything
            const participant = payload.new as RoomParticipant;
            if (participant.user_id === userId) {
              useRoomStore.getState().clearUnread(participant.room_id);
            }
          }
        )
        .subscribe((status) => {
          if (disposed) return;

          if (status === "SUBSCRIBED") {
            if (hadDrop) {
              // Recover unread counts / last messages missed while offline
              hadDrop = false;
              resync();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            hadDrop = true;
            scheduleReconnect();
          }
        });
    };

    connect();

    // Android tears the socket down in background: resync on foreground
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (disposed || state !== "active") return;

      resync();
      if (channel?.state !== "joined") {
        hadDrop = false;
        scheduleReconnect();
      }
    });

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      appStateSub.remove();
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);
}

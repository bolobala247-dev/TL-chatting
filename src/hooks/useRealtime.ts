import { useEffect } from "react";
import { AppState } from "react-native";
import { supabase } from "@/src/lib/supabase";
import { useChatStore } from "@/src/stores/chatStore";
import { useRoomStore } from "@/src/stores/roomStore";
import { useAuthStore } from "@/src/stores/authStore";
import { syncService } from "@/src/services/syncService";
import { outboxService } from "@/src/services/outboxService";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  Message,
  MessageReaction,
  PollVote,
  RoomParticipant,
  RoomRead,
} from "@/src/types";

const RESUBSCRIBE_DELAY_MS = 3000;

// Cache sender names for room list previews (audit P14).
// LRU-capped so the map cannot grow unbounded over a long session.
const SENDER_NAME_CACHE_MAX = 200;
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
  if (cached) {
    // Refresh recency (Map preserves insertion order)
    senderNameCache.delete(senderId);
    senderNameCache.set(senderId, cached);
    return cached;
  }

  const { data } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", senderId)
    .maybeSingle();

  const name = data?.display_name || data?.username || null;
  if (name) {
    if (senderNameCache.size >= SENDER_NAME_CACHE_MAX) {
      // Evict the least recently used entry
      const oldest = senderNameCache.keys().next().value;
      if (oldest !== undefined) senderNameCache.delete(oldest);
    }
    senderNameCache.set(senderId, name);
  }
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
              // Recover messages missed while offline. The room is resident
              // (the user is viewing it) → syncService takes the delta lane
              // when the flag is on; with the flag off this delegates to the
              // exact page-1 fetch used before (§10.4).
              hadDrop = false;
              void syncService.syncNow({ room: roomId });
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

    // Reconnect / foreground recovery: syncService takes the room-list delta
    // lane when the flag is on (payload ≪ full get_user_rooms); with the flag
    // off it delegates to the exact fetchRooms above (§10.4). Membership
    // add/remove events keep the full resync() — a delta can't express
    // "you were removed from room X" (§12 R4).
    const deltaResync = () => {
      void syncService.syncNow("rooms");
      // Connectivity/foreground regained is also an outbox wakeup (§3.4 #2/#3):
      // drain any queued sends that were waiting for the network. No-op when
      // FEATURE_OFFLINE_OUTBOX is off.
      outboxService.poke();
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
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "room_reads",
          },
          (payload) => {
            // Private read watermark (always written even when read
            // receipts are off). RLS limits events to own rows only.
            useRoomStore
              .getState()
              .clearUnread((payload.new as RoomRead).room_id);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "room_reads",
          },
          (payload) => {
            useRoomStore
              .getState()
              .clearUnread((payload.new as RoomRead).room_id);
          }
        )
        .subscribe((status) => {
          if (disposed) return;

          if (status === "SUBSCRIBED") {
            if (hadDrop) {
              // Recover unread counts / last messages missed while offline
              hadDrop = false;
              deltaResync();
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

      deltaResync();
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

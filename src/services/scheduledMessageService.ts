import { supabase } from "@/src/lib/supabase";
import type { ScheduledMessage } from "@/src/types";

export const scheduledMessageService = {
  async schedule(
    roomId: string,
    senderId: string,
    content: string,
    scheduledAt: Date,
    replyTo?: string
  ): Promise<ScheduledMessage> {
    const { data, error } = await supabase
      .from("scheduled_messages")
      .insert({
        room_id: roomId,
        sender_id: senderId,
        content,
        scheduled_at: scheduledAt.toISOString(),
        reply_to: replyTo ?? null,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // RLS already scopes rows to the caller (sender_id = auth.uid())
  async getPendingForRoom(roomId: string): Promise<ScheduledMessage[]> {
    const { data, error } = await supabase
      .from("scheduled_messages")
      .select("*")
      .eq("room_id", roomId)
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  },

  // Cancel = delete the pending row (RLS blocks deleting sent/failed history)
  async cancel(id: string): Promise<void> {
    const { error } = await supabase
      .from("scheduled_messages")
      .delete()
      .eq("id", id);

    if (error) throw error;
  },
};

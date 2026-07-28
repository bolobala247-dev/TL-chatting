import { supabase } from "@/src/lib/supabase";

export const pollService = {
  // Single choice: changing the vote upserts on (message_id, user_id)
  async vote(
    messageId: string,
    roomId: string,
    userId: string,
    optionIndex: number
  ): Promise<void> {
    const { error } = await supabase.from("poll_votes").upsert(
      {
        message_id: messageId,
        room_id: roomId,
        user_id: userId,
        option_index: optionIndex,
      },
      { onConflict: "message_id,user_id" }
    );

    if (error) throw error;
  },

  async unvote(messageId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from("poll_votes")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId);

    if (error) throw error;
  },
};

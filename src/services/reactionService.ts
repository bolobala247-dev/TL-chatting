import { supabase } from "@/src/lib/supabase";

export const reactionService = {
  async addReaction(
    messageId: string,
    roomId: string,
    userId: string,
    emoji: string
  ): Promise<void> {
    const { error } = await supabase.from("message_reactions").insert({
      message_id: messageId,
      room_id: roomId,
      user_id: userId,
      emoji,
    });

    if (error) throw error;
  },

  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string
  ): Promise<void> {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji);

    if (error) throw error;
  },
};

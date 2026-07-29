import { supabase } from "@/src/lib/supabase";
import { SEARCH_PAGE_SIZE } from "@/src/lib/constants";
import type { MessageSearchKind, MessageSearchResult } from "@/src/types";

export const searchService = {
  // Backed by the search_messages RPC (trgm index, scoped to my rooms).
  // Media lanes accept an empty query (browse recent), the message lane
  // requires text — the RPC enforces the same rule.
  async searchMessages(
    query: string,
    kind: MessageSearchKind,
    options?: { roomId?: string; before?: string; limit?: number }
  ): Promise<MessageSearchResult[]> {
    const { data, error } = await supabase.rpc("search_messages", {
      p_query: query.trim(),
      p_kind: kind,
      p_room_id: options?.roomId,
      p_before: options?.before,
      p_limit: options?.limit ?? SEARCH_PAGE_SIZE,
    });

    if (error) throw error;
    return (data ?? []) as MessageSearchResult[];
  },
};

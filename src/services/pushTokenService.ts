import { supabase } from "@/src/lib/supabase";
import type { InsertTables } from "@/src/types";

let currentToken: string | null = null;

export const pushTokenService = {
  setCurrentToken(token: string | null) {
    currentToken = token;
  },

  getCurrentToken() {
    return currentToken;
  },

  async upsertToken(
    userId: string,
    token: string,
    platform: InsertTables<"push_tokens">["platform"],
    deviceId?: string
  ): Promise<void> {
    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        token,
        platform,
        device_id: deviceId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" }
    );

    if (error) throw error;
    currentToken = token;
  },

  async removeToken(token: string): Promise<void> {
    const { error } = await supabase
      .from("push_tokens")
      .delete()
      .eq("token", token);

    if (error) throw error;

    if (currentToken === token) {
      currentToken = null;
    }
  },

  async removeCurrentToken(): Promise<void> {
    if (!currentToken) return;
    await this.removeToken(currentToken);
  },
};

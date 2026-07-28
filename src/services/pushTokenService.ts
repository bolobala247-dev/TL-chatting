import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import i18n from "@/src/i18n";
import { supabase } from "@/src/lib/supabase";
import type { InsertTables } from "@/src/types";

// Persisted so sign-out cleanup still works after an app restart (audit P7)
const TOKEN_STORAGE_KEY = "tl-push-token";
// Marks which user/token pair is already synced to avoid a DB write on every
// app foreground (audit P15)
const SYNCED_STORAGE_KEY = "tl-push-token-synced";

let currentToken: string | null = null;

async function readStoredValue(key: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeStoredValue(key: string, value: string | null) {
  if (Platform.OS === "web") return;
  try {
    if (value === null) {
      await SecureStore.deleteItemAsync(key);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  } catch {
    // Storage failure must not break push registration
  }
}

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
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user || session.user.id !== userId) {
      throw new Error(i18n.t("errors:sessionNotReady"));
    }

    // Already synced for this user/token pair: skip the DB round-trip
    const syncedMarker = `${userId}:${token}`;
    const previousMarker = await readStoredValue(SYNCED_STORAGE_KEY);
    if (previousMarker === syncedMarker) {
      currentToken = token;
      return;
    }

    if (deviceId) {
      await supabase
        .from("push_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("device_id", deviceId);
    }

    const row = {
      user_id: userId,
      token,
      platform,
      device_id: deviceId ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error: insertError } = await supabase
      .from("push_tokens")
      .insert(row);

    if (insertError) {
      const { error: upsertError } = await supabase
        .from("push_tokens")
        .upsert(row, { onConflict: "user_id,token" });

      if (upsertError) throw upsertError;
    }

    currentToken = token;
    await writeStoredValue(TOKEN_STORAGE_KEY, token);
    await writeStoredValue(SYNCED_STORAGE_KEY, syncedMarker);
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
    await writeStoredValue(TOKEN_STORAGE_KEY, null);
    await writeStoredValue(SYNCED_STORAGE_KEY, null);
  },

  async removeCurrentToken(): Promise<void> {
    // Fall back to the persisted token so cleanup survives app restarts
    const token = currentToken ?? (await readStoredValue(TOKEN_STORAGE_KEY));
    if (!token) return;
    await this.removeToken(token);
  },
};

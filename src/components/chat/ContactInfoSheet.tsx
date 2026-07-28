import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/src/stores/authStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { PeerProfile } from "@/src/types";

interface ContactInfoSheetProps {
  visible: boolean;
  /** Privacy-gated peer view (get_peer_profile); null while loading. */
  peer: PeerProfile | null;
  /** Fallbacks from the participants fetch so the sheet never opens empty. */
  fallbackName: string;
  fallbackAvatarUrl: string | null;
  onClose: () => void;
  /** Opens the report flow (sheet swap handled by the parent). */
  onReport: () => void;
  /** Called after a successful block/unblock so the parent can refresh. */
  onBlockChanged?: () => void;
}

// DM contact card: name, @username, phone (only when the peer's
// phone_visibility allows it — the RPC already returns null otherwise),
// plus Block/Unblock and Report actions.
export function ContactInfoSheet({
  visible,
  peer,
  fallbackName,
  fallbackAvatarUrl,
  onClose,
  onReport,
  onBlockChanged,
}: ContactInfoSheetProps) {
  const { t } = useTranslation(["chat", "common"]);
  const userId = useAuthStore((s) => s.user?.id);
  const blockUser = usePrivacyStore((s) => s.blockUser);
  const unblockUser = usePrivacyStore((s) => s.unblockUser);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const name = peer ? peer.display_name || peer.username : fallbackName;
  const avatarUrl = peer ? peer.avatar_url : fallbackAvatarUrl;
  const isBlocked = peer?.is_blocked_by_me ?? false;

  const closeAndReset = () => {
    setError("");
    onClose();
  };

  const handleBlockConfirm = async () => {
    setConfirmBlock(false);
    if (!userId || !peer) return;
    setBusy(true);
    setError("");
    try {
      await blockUser(userId, peer.id);
      onBlockChanged?.();
    } catch (err) {
      console.error("[ContactInfoSheet] block", err);
      setError(t("chat:block.failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async () => {
    if (!userId || !peer) return;
    setBusy(true);
    setError("");
    try {
      await unblockUser(userId, peer.id);
      onBlockChanged?.();
    } catch (err) {
      console.error("[ContactInfoSheet] unblock", err);
      setError(t("chat:block.unblockFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet visible={visible} onClose={closeAndReset}>
        <View className="items-center gap-2 border-b border-divider px-4 py-5">
          <Avatar uri={avatarUrl} name={name} size={64} />
          <Text className="font-sans-semibold text-title text-fg" numberOfLines={1}>
            {name}
          </Text>
          {peer && (
            <Text className="font-sans text-caption text-fg-tertiary">
              @{peer.username}
            </Text>
          )}
          {peer?.phone_number && (
            <View className="flex-row items-center gap-1.5">
              <Icon
                name={{ ios: "phone", android: "call", web: "call" }}
                tone="tertiary"
                size="sm"
              />
              <Text className="font-sans text-caption text-fg-secondary">
                {peer.phone_number}
              </Text>
            </View>
          )}
        </View>

        {error ? (
          <View className="px-4 pt-2">
            <FormMessage>{error}</FormMessage>
          </View>
        ) : null}

        <Pressable
          className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
          onPress={() => {
            closeAndReset();
            onReport();
          }}
          accessibilityRole="button"
        >
          <Icon
            name={{
              ios: "exclamationmark.bubble",
              android: "flag",
              web: "flag",
            }}
            tone="secondary"
            size="md"
          />
          <Text className="font-sans text-body text-fg">
            {t("chat:report.action")}
          </Text>
        </Pressable>

        <Pressable
          className="flex-row items-center gap-3 border-t border-divider px-4 py-3.5 active:bg-pressed"
          onPress={isBlocked ? handleUnblock : () => setConfirmBlock(true)}
          disabled={busy || !peer}
          accessibilityRole="button"
        >
          <Icon
            name={
              isBlocked
                ? {
                    ios: "person.crop.circle.badge.checkmark",
                    android: "how_to_reg",
                    web: "how_to_reg",
                  }
                : {
                    ios: "person.crop.circle.badge.xmark",
                    android: "block",
                    web: "block",
                  }
            }
            tone={isBlocked ? "secondary" : "danger"}
            size="md"
          />
          <Text
            className={`text-body ${
              isBlocked
                ? "font-sans text-fg"
                : "font-sans-medium text-danger"
            }`}
          >
            {isBlocked ? t("chat:block.unblock") : t("chat:block.action")}
          </Text>
        </Pressable>
      </Sheet>

      <ConfirmDialog
        visible={confirmBlock}
        title={t("chat:block.confirmTitle")}
        message={t("chat:block.confirmMessage")}
        confirmText={t("chat:block.action")}
        cancelText={t("common:actions.cancel")}
        destructive
        onConfirm={handleBlockConfirm}
        onCancel={() => setConfirmBlock(false)}
      />
    </>
  );
}

import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/src/stores/authStore";
import { profileService } from "@/src/services/profileService";
import { roomService } from "@/src/services/roomService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Button } from "@/src/components/ui/Button";
import { Icon } from "@/src/components/ui/Icon";
import { SearchField } from "@/src/components/ui/SearchField";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { Profile } from "@/src/types";

interface CreateRoomModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CreateRoomModal({ visible, onClose }: CreateRoomModalProps) {
  const { t } = useTranslation(["chat", "common"]);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Profile[]>([]);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [groupNameError, setGroupNameError] = useState("");
  const [formError, setFormError] = useState("");

  const isGroup = selectedUsers.length > 1;

  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim() || !user) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const results = await profileService.searchUsers(query.trim(), user.id);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [user]
  );

  const toggleUser = (profile: Profile) => {
    setSelectedUsers((prev) => {
      const exists = prev.find((u) => u.id === profile.id);
      if (exists) return prev.filter((u) => u.id !== profile.id);
      return [...prev, profile];
    });
  };

  const handleCreate = async () => {
    if (!user || selectedUsers.length === 0) return;

    setGroupNameError("");
    setFormError("");
    setLoading(true);
    try {
      let room;
      if (isGroup) {
        if (!groupName.trim()) {
          setGroupNameError(t("create.groupNameRequired"));
          setLoading(false);
          return;
        }
        room = await roomService.createGroupRoom(
          user.id,
          groupName.trim(),
          selectedUsers.map((u) => u.id)
        );
      } else {
        room = await roomService.createDirectRoom(
          user.id,
          selectedUsers[0].id
        );
      }

      handleClose();
      router.push(`/chat/${room.id}` as any);
    } catch (err: unknown) {
      console.error("[CreateRoomModal]", err);
      const msg =
        err instanceof Error
          ? err.message
          : t("create.failed");
      setFormError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSelectedUsers([]);
    setGroupName("");
    setGroupNameError("");
    setFormError("");
    onClose();
  };

  const renderUserItem = ({ item }: { item: Profile }) => {
    const isSelected = selectedUsers.some((u) => u.id === item.id);
    return (
      <Pressable
        className={`flex-row items-center gap-3 px-4 py-3 ${isSelected ? "bg-surface-secondary" : "active:bg-pressed"}`}
        onPress={() => toggleUser(item)}
        accessibilityRole="button"
      >
        <Avatar
          uri={item.avatar_url}
          name={item.display_name || item.username}
          size={44}
        />
        <View className="flex-1">
          <Text className="font-sans-medium text-body text-fg">
            {item.display_name || item.username}
          </Text>
          <Text className="font-sans text-caption text-fg-tertiary">@{item.username}</Text>
        </View>
        {isSelected && (
          <Icon
            name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }}
            tone="ink"
            size="md"
          />
        )}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-row items-center justify-between border-b border-divider px-4 pb-3 pt-4">
          <Pressable onPress={handleClose} accessibilityRole="button">
            <Text className="font-sans text-body text-fg-secondary">{t("common:actions.cancel")}</Text>
          </Pressable>
          <Text className="font-sans-semibold text-title text-fg">
            {t("create.title")}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View className="border-b border-divider px-4 py-3">
          <SearchField
            placeholder={t("search.placeholder")}
            value={searchQuery}
            onChangeText={handleSearch}
            autoCapitalize="none"
          />
        </View>

        {selectedUsers.length > 0 && (
          <View className="border-b border-divider px-4 py-3">
            <View className="flex-row flex-wrap gap-2">
              {selectedUsers.map((u) => (
                <Pressable
                  key={u.id}
                  className="flex-row items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-3 py-1.5 active:bg-pressed"
                  onPress={() => toggleUser(u)}
                  accessibilityRole="button"
                >
                  <Text className="font-sans-medium text-caption text-fg">
                    {u.display_name || u.username}
                  </Text>
                  <Icon
                    name={{ ios: "xmark", android: "close", web: "close" }}
                    tone="secondary"
                    size={12}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {isGroup && (
          <View className="border-b border-divider px-4 py-3">
            <TextField
              placeholder={t("create.groupNamePlaceholder")}
              value={groupName}
              onChangeText={(text) => {
                setGroupName(text);
                if (groupNameError) setGroupNameError("");
              }}
              error={groupNameError || undefined}
            />
          </View>
        )}

        <FlatList
          data={searchResults}
          renderItem={renderUserItem}
          keyExtractor={(item) => item.id}
          className="flex-1"
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="font-sans text-caption text-fg-tertiary">
                {searchQuery
                  ? searching
                    ? t("search.searching")
                    : t("search.noResults")
                  : t("create.typeToSearch")}
              </Text>
            </View>
          }
        />

        {selectedUsers.length > 0 && (
          <View className="border-t border-divider px-4 py-3">
            {formError ? (
              <FormMessage className="mb-2">{formError}</FormMessage>
            ) : null}
            <Button
              title={isGroup ? t("create.createGroup") : t("create.startChat")}
              onPress={handleCreate}
              loading={loading}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

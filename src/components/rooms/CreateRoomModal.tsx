import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/src/stores/authStore";
import { profileService } from "@/src/services/profileService";
import { roomService } from "@/src/services/roomService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Button } from "@/src/components/ui/Button";
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
        className={`flex-row items-center gap-3 px-4 py-3 ${isSelected ? "bg-primary-50" : "active:bg-gray-50"}`}
        onPress={() => toggleUser(item)}
      >
        <Avatar
          uri={item.avatar_url}
          name={item.display_name || item.username}
          size={44}
        />
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-gray-900">
            {item.display_name || item.username}
          </Text>
          <Text className="text-sm text-gray-500">@{item.username}</Text>
        </View>
        {isSelected && (
          <SymbolView
            name={{ ios: "checkmark.circle.fill", android: "check_circle", web: "check_circle" }}
            tintColor="#2563EB"
            size={22}
          />
        )}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        className="flex-1 bg-white"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-row items-center justify-between border-b border-gray-100 px-4 pb-3 pt-4">
          <Pressable onPress={handleClose}>
            <Text className="text-base text-gray-500">{t("common:actions.cancel")}</Text>
          </Pressable>
          <Text className="text-lg font-semibold text-gray-900">
            {t("create.title")}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View className="border-b border-gray-100 px-4 py-3">
          <TextInput
            className="h-10 rounded-xl bg-gray-100 px-4 text-[15px] text-gray-900"
            placeholder={t("search.placeholder")}
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={handleSearch}
            autoCapitalize="none"
          />
        </View>

        {selectedUsers.length > 0 && (
          <View className="border-b border-gray-100 px-4 py-3">
            <View className="flex-row flex-wrap gap-2">
              {selectedUsers.map((u) => (
                <Pressable
                  key={u.id}
                  className="flex-row items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1.5"
                  onPress={() => toggleUser(u)}
                >
                  <Text className="text-sm font-medium text-primary-700">
                    {u.display_name || u.username}
                  </Text>
                  <SymbolView
                    name={{ ios: "xmark", android: "close", web: "close" }}
                    tintColor="#1D4ED8"
                    size={12}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {isGroup && (
          <View className="border-b border-gray-100 px-4 py-3">
            <TextInput
              className={`h-10 rounded-xl bg-gray-100 px-4 text-[15px] text-gray-900 ${
                groupNameError ? "border border-red-500" : ""
              }`}
              placeholder={t("create.groupNamePlaceholder")}
              placeholderTextColor="#9CA3AF"
              value={groupName}
              onChangeText={(text) => {
                setGroupName(text);
                if (groupNameError) setGroupNameError("");
              }}
            />
            {groupNameError ? (
              <Text className="mt-1.5 text-sm text-red-600">{groupNameError}</Text>
            ) : null}
          </View>
        )}

        <FlatList
          data={searchResults}
          renderItem={renderUserItem}
          keyExtractor={(item) => item.id}
          className="flex-1"
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-sm text-gray-400">
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
          <View className="border-t border-gray-100 px-4 py-3">
            {formError ? (
              <Text className="mb-2 text-sm text-red-600">{formError}</Text>
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

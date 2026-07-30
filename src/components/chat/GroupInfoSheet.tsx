import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";
import { roomService } from "@/src/services/roomService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { Room, RoomParticipantWithProfile } from "@/src/types";

interface GroupInfoSheetProps {
  visible: boolean;
  room: Room;
  participants: RoomParticipantWithProfile[];
  /** Only group admins may edit name/avatar (matches rooms_update RLS). */
  isAdmin: boolean;
  onClose: () => void;
  /** Fires with the updated row so the parent refreshes the header. */
  onRoomUpdated: (room: Room) => void;
}

// Group card: avatar + name (editable by admins) and the member list.
export function GroupInfoSheet({
  visible,
  room,
  participants,
  isAdmin,
  onClose,
  onRoomUpdated,
}: GroupInfoSheetProps) {
  const { t } = useTranslation(["chat", "common", "errors"]);
  const [name, setName] = useState(room.name ?? "");
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Re-sync the draft name whenever the sheet opens
  useEffect(() => {
    if (visible) {
      setName(room.name ?? "");
      setNameError("");
      setError("");
    }
  }, [visible, room.name]);

  const dirty = name.trim() !== (room.name ?? "");

  const handleSaveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t("chat:create.groupNameRequired"));
      return;
    }

    setNameError("");
    setError("");
    setSaving(true);
    try {
      const updated = await roomService.updateGroupRoom(room.id, {
        name: trimmed,
      });
      onRoomUpdated(updated);
    } catch (err) {
      console.error("[GroupInfoSheet] update name", err);
      setError(t("chat:group.updateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError(t("errors:mediaLibraryPermission"));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const publicUrl = await roomService.uploadGroupAvatar(
        room.id,
        result.assets[0].uri
      );
      const updated = await roomService.updateGroupRoom(room.id, {
        avatar_url: publicUrl,
      });
      onRoomUpdated(updated);
    } catch (err) {
      console.error("[GroupInfoSheet] upload avatar", err);
      setError(t("chat:group.updateFailed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="items-center gap-3 border-b border-divider px-4 py-5">
        <Pressable
          onPress={isAdmin ? handlePickAvatar : undefined}
          disabled={uploading}
          accessibilityRole={isAdmin ? "button" : undefined}
          accessibilityLabel={isAdmin ? t("chat:group.changeAvatar") : undefined}
        >
          <Avatar uri={room.avatar_url} name={room.name} size={72} />
          {isAdmin && (
            <View className="absolute -bottom-1 -right-1 h-7 w-7 items-center justify-center rounded-full border border-border bg-surface">
              <Icon
                name={{ ios: "camera", android: "photo_camera", web: "photo_camera" }}
                tone="secondary"
                size="sm"
              />
            </View>
          )}
        </Pressable>

        {isAdmin ? (
          <View className="w-full gap-2">
            <TextField
              value={name}
              onChangeText={setName}
              placeholder={t("chat:create.groupNamePlaceholder")}
              error={nameError}
              maxLength={80}
            />
            {dirty && (
              <Button
                title={t("common:actions.save")}
                size="md"
                loading={saving}
                onPress={handleSaveName}
              />
            )}
          </View>
        ) : (
          <Text
            className="font-sans-semibold text-title text-fg"
            numberOfLines={1}
          >
            {room.name}
          </Text>
        )}

        <Text className="font-sans text-caption text-fg-tertiary">
          {t("chat:header.members", { count: participants.length })}
        </Text>
      </View>

      {error ? (
        <View className="px-4 pt-2">
          <FormMessage>{error}</FormMessage>
        </View>
      ) : null}

      <ScrollView className="max-h-72">
        {participants.map((p) => (
          <View
            key={p.id}
            className="flex-row items-center gap-3 px-4 py-2.5"
          >
            <Avatar
              uri={p.profiles?.avatar_url}
              name={p.profiles?.display_name || p.profiles?.username}
              size={36}
            />
            <Text className="flex-1 font-sans text-body text-fg" numberOfLines={1}>
              {p.profiles?.display_name || p.profiles?.username}
            </Text>
            {p.role === "admin" && (
              <Text className="font-sans text-caption text-fg-tertiary">
                {t("chat:group.adminRole")}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

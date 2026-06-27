import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useAuthStore } from "@/src/stores/authStore";
import { profileService } from "@/src/services/profileService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";

export default function SettingsScreen() {
  const { profile, user, signOut, fetchProfile } = useAuthStore();
  const [displayName, setDisplayName] = useState(
    profile?.display_name || ""
  );
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [signOutError, setSignOutError] = useState("");

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    setProfileSuccess("");
    setProfileError("");
    try {
      await profileService.updateProfile(user.id, {
        display_name: displayName.trim() || null,
      });
      await fetchProfile();
      setProfileSuccess("Đã cập nhật hồ sơ");
    } catch (err: unknown) {
      console.error("[Settings] save profile", err);
      const msg =
        err instanceof Error ? err.message : "Không thể cập nhật hồ sơ";
      setProfileError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!user) return;
    setAvatarError("");

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAvatarError("Cần quyền truy cập thư viện ảnh");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) return;

    setUploadingAvatar(true);
    try {
      await profileService.uploadAvatar(user.id, result.assets[0].uri);
      await fetchProfile();
    } catch (err: unknown) {
      console.error("[Settings] upload avatar", err);
      const msg =
        err instanceof Error ? err.message : "Không thể tải ảnh đại diện";
      setAvatarError(msg);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSignOut = () => {
    setSignOutError("");
    setShowSignOutConfirm(true);
  };

  const confirmSignOut = async () => {
    setShowSignOutConfirm(false);
    try {
      await signOut();
    } catch (err: unknown) {
      console.error("[Settings] sign out", err);
      const msg =
        err instanceof Error
          ? err.message
          : "Không thể đăng xuất, vui lòng thử lại";
      setSignOutError(msg);
    }
  };

  return (
    <>
    <ScrollView className="flex-1 bg-white">
      <View className="items-center px-4 pt-6">
        <Pressable onPress={handlePickAvatar} disabled={uploadingAvatar}>
          <Avatar
            uri={profile?.avatar_url}
            name={profile?.display_name || profile?.username}
            size={90}
          />
          <View className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary-600">
            <Text className="text-xs text-white">
              {uploadingAvatar ? "..." : "📷"}
            </Text>
          </View>
        </Pressable>

        <Text className="mt-3 text-sm text-gray-500">
          @{profile?.username || "unknown"}
        </Text>

        {avatarError ? (
          <Text className="mt-2 text-center text-sm text-red-600">
            {avatarError}
          </Text>
        ) : null}
      </View>

      <View className="mt-6 px-4">
        <Text className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Hồ sơ
        </Text>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              Tên hiển thị
            </Text>
            <TextInput
              className={`h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900 ${
                profileError ? "border-red-500" : "border-gray-300"
              }`}
              value={displayName}
              onChangeText={(text) => {
                setDisplayName(text);
                if (profileError) setProfileError("");
                if (profileSuccess) setProfileSuccess("");
              }}
              placeholder="Nhập tên hiển thị"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {profileSuccess ? (
            <Text className="text-sm text-green-600">{profileSuccess}</Text>
          ) : null}
          {profileError ? (
            <Text className="text-sm text-red-600">{profileError}</Text>
          ) : null}

          <Button
            title="Lưu thay đổi"
            onPress={handleSaveProfile}
            loading={saving}
            variant="primary"
          />
        </View>
      </View>

      <View className="mt-8 px-4 pb-10">
        <Text className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Tài khoản
        </Text>

        <View className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-gray-600">Email</Text>
            <Text className="text-sm font-medium text-gray-900">
              {user?.email || "N/A"}
            </Text>
          </View>
        </View>

        {signOutError ? (
          <Text className="mt-4 text-center text-sm text-red-600">
            {signOutError}
          </Text>
        ) : null}

        <Pressable
          className="mt-4 h-12 items-center justify-center rounded-xl bg-red-50 active:bg-red-100"
          onPress={handleSignOut}
        >
          <Text className="text-base font-semibold text-red-600">
            Đăng xuất
          </Text>
        </Pressable>
      </View>
    </ScrollView>

    <ConfirmDialog
      visible={showSignOutConfirm}
      title="Đăng xuất"
      message="Bạn có chắc muốn đăng xuất?"
      confirmText="Đăng xuất"
      cancelText="Huỷ"
      destructive
      onConfirm={confirmSignOut}
      onCancel={() => setShowSignOutConfirm(false)}
    />
    </>
  );
}

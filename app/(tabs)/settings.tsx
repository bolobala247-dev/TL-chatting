import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
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

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await profileService.updateProfile(user.id, {
        display_name: displayName.trim() || null,
      });
      await fetchProfile();
      Alert.alert("Thành công", "Đã cập nhật hồ sơ");
    } catch (error: any) {
      Alert.alert("Lỗi", error.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePickAvatar = async () => {
    if (!user) return;

    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Lỗi", "Cần quyền truy cập thư viện ảnh");
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
    } catch (error: any) {
      Alert.alert("Lỗi", error.message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSignOut = () => {
    setShowSignOutConfirm(true);
  };

  const confirmSignOut = async () => {
    setShowSignOutConfirm(false);
    try {
      await signOut();
    } catch (error: any) {
      Alert.alert("Lỗi", error.message || "Không thể đăng xuất");
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
              className="h-12 rounded-xl border border-gray-300 bg-gray-50 px-4 text-base text-gray-900"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Nhập tên hiển thị"
              placeholderTextColor="#9CA3AF"
            />
          </View>

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

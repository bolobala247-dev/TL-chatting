import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  setAppLanguage,
  type AppLanguage,
} from "@/src/i18n";
import { useAuthStore } from "@/src/stores/authStore";
import { profileService } from "@/src/services/profileService";
import {
  getNotificationPermissionStatus,
  registerPushNotificationsForUser,
} from "@/src/services/notificationService";
import { Avatar } from "@/src/components/ui/Avatar";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/ConfirmDialog";

// Static keys so the notification status stays translated after a language switch
const NOTIFICATION_STATUS_KEYS = {
  unsupported: "notifications.statusUnsupported",
  granted: "notifications.statusGranted",
  notGranted: "notifications.statusNotGranted",
  registered: "notifications.registered",
} as const;

type NotificationStatusKey = keyof typeof NOTIFICATION_STATUS_KEYS;

export default function SettingsScreen() {
  const { t, i18n } = useTranslation(["settings", "profile", "common", "errors"]);
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
  const [notificationStatus, setNotificationStatus] =
    useState<NotificationStatusKey | "">("");
  const [notificationError, setNotificationError] = useState("");
  const [registeringNotifications, setRegisteringNotifications] =
    useState(false);

  const refreshNotificationStatus = useCallback(async () => {
    const status = await getNotificationPermissionStatus();
    if (status === "unsupported") {
      setNotificationStatus("unsupported");
      return;
    }
    if (status === "granted") {
      setNotificationStatus("granted");
      return;
    }
    setNotificationStatus("notGranted");
  }, []);

  useEffect(() => {
    void refreshNotificationStatus();
  }, [refreshNotificationStatus]);

  const handleEnableNotifications = async () => {
    if (!user) return;

    setRegisteringNotifications(true);
    setNotificationError("");

    const result = await registerPushNotificationsForUser(user.id);
    await refreshNotificationStatus();

    if (result.ok) {
      setNotificationStatus("registered");
    } else {
      setNotificationError(result.reason);
    }

    setRegisteringNotifications(false);
  };

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
      setProfileSuccess(t("profile:updated"));
    } catch (err: unknown) {
      console.error("[Settings] save profile", err);
      const msg =
        err instanceof Error ? err.message : t("profile:updateFailed");
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
      setAvatarError(t("errors:mediaLibraryPermission"));
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
        err instanceof Error ? err.message : t("profile:avatarUploadFailed");
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
          : t("account.signOutFailed");
      setSignOutError(msg);
    }
  };

  const handleSelectLanguage = async (language: AppLanguage) => {
    await setAppLanguage(language);

    // Logged-in users carry their language across devices via the profile
    if (user) {
      try {
        await profileService.updateProfile(user.id, {
          preferred_language: language,
        });
      } catch (err: unknown) {
        console.error("[Settings] save preferred language", err);
      }
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
          {t("profile:sectionTitle")}
        </Text>

        <View className="gap-4">
          <View>
            <Text className="mb-1.5 text-sm font-medium text-gray-700">
              {t("profile:displayName.label")}
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
              placeholder={t("profile:displayName.placeholder")}
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
            title={t("profile:save")}
            onPress={handleSaveProfile}
            loading={saving}
            variant="primary"
          />
        </View>
      </View>

      <View className="mt-8 px-4">
        <Text className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t("language.sectionTitle")}
        </Text>

        <View className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          {SUPPORTED_LANGUAGES.map((language, index) => (
            <Pressable
              key={language}
              className={`flex-row items-center justify-between px-4 py-3.5 active:bg-gray-100 ${
                index > 0 ? "border-t border-gray-200" : ""
              }`}
              onPress={() => handleSelectLanguage(language)}
            >
              <Text className="text-[15px] text-gray-900">
                {LANGUAGE_LABELS[language]}
              </Text>
              {i18n.language === language ? (
                <SymbolView
                  name={{ ios: "checkmark", android: "check", web: "check" }}
                  tintColor="#2563EB"
                  size={18}
                />
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>

      <View className="mt-8 px-4">
        <Text className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t("notifications.sectionTitle")}
        </Text>

        <View className="gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <Text className="text-sm text-gray-600">
            {notificationStatus
              ? t(NOTIFICATION_STATUS_KEYS[notificationStatus])
              : ""}
          </Text>

          {notificationError ? (
            <Text className="text-sm text-red-600">{notificationError}</Text>
          ) : null}

          <Button
            title={t("notifications.enable")}
            onPress={handleEnableNotifications}
            loading={registeringNotifications}
            variant="secondary"
          />
        </View>
      </View>

      <View className="mt-8 px-4 pb-10">
        <Text className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t("account.sectionTitle")}
        </Text>

        <View className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-gray-600">{t("account.email")}</Text>
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
            {t("account.signOut")}
          </Text>
        </Pressable>
      </View>
    </ScrollView>

    <ConfirmDialog
      visible={showSignOutConfirm}
      title={t("account.signOutConfirmTitle")}
      message={t("account.signOutConfirmMessage")}
      confirmText={t("account.signOut")}
      cancelText={t("common:actions.cancel")}
      destructive
      onConfirm={confirmSignOut}
      onCancel={() => setShowSignOutConfirm(false)}
    />
    </>
  );
}

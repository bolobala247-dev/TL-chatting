import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/src/lib/keyboard";
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
import { Icon } from "@/src/components/ui/Icon";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { Card, ListGroup } from "@/src/components/ui/Card";
import { useTheme, type ThemePreference } from "@/src/theme";

// Static keys so the notification status stays translated after a language switch
const NOTIFICATION_STATUS_KEYS = {
  unsupported: "notifications.statusUnsupported",
  granted: "notifications.statusGranted",
  notGranted: "notifications.statusNotGranted",
  registered: "notifications.registered",
} as const;

type NotificationStatusKey = keyof typeof NOTIFICATION_STATUS_KEYS;

const THEME_OPTIONS: ThemePreference[] = ["light", "dark", "system"];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation(["settings", "profile", "common", "errors"]);
  const router = useRouter();
  const { profile, user, signOut, fetchProfile } = useAuthStore();
  const { preference, colors, setPreference } = useTheme();
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
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View className="items-center px-4 pt-6">
        <Pressable
          onPress={handlePickAvatar}
          disabled={uploadingAvatar}
          accessibilityRole="button"
          accessibilityLabel={t("profile:sectionTitle")}
        >
          <Avatar
            uri={profile?.avatar_url}
            name={profile?.display_name || profile?.username}
            size={90}
          />
          <View className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-ink">
            {uploadingAvatar ? (
              <ActivityIndicator size="small" color={colors.inkInverse} />
            ) : (
              <Icon
                name={{
                  ios: "camera.fill",
                  android: "photo_camera",
                  web: "photo_camera",
                }}
                tone="inverse"
                size="sm"
              />
            )}
          </View>
        </Pressable>

        <Text className="mt-3 font-sans text-caption text-fg-tertiary">
          @{profile?.username || "unknown"}
        </Text>

        {avatarError ? (
          <FormMessage className="mt-2 text-center">{avatarError}</FormMessage>
        ) : null}
      </View>

      <View className="mt-6 px-4">
        <SectionHeader title={t("profile:sectionTitle")} className="mb-4" />

        <View className="gap-4">
          <TextField
            label={t("profile:displayName.label")}
            value={displayName}
            onChangeText={(text) => {
              setDisplayName(text);
              if (profileError) setProfileError("");
              if (profileSuccess) setProfileSuccess("");
            }}
            placeholder={t("profile:displayName.placeholder")}
            error={profileError || undefined}
            returnKeyType="done"
            onSubmitEditing={handleSaveProfile}
          />

          {profileSuccess ? (
            <FormMessage tone="success">{profileSuccess}</FormMessage>
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
        <SectionHeader title={t("archive.sectionTitle")} className="mb-4" />

        <ListGroup>
          <Pressable
            className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
            onPress={() => router.push("/saved-messages")}
            accessibilityRole="button"
          >
            <Icon
              name={{ ios: "bookmark", android: "bookmark", web: "bookmark" }}
              tone="secondary"
              size="md"
            />
            <Text className="flex-1 font-sans text-body text-fg">
              {t("archive.savedMessages")}
            </Text>
            <Icon
              name={{
                ios: "chevron.right",
                android: "chevron_right",
                web: "chevron_right",
              }}
              tone="tertiary"
              size="sm"
            />
          </Pressable>
        </ListGroup>
      </View>

      <View className="mt-8 px-4">
        <SectionHeader title={t("appearance.sectionTitle")} className="mb-4" />

        <ListGroup>
          {THEME_OPTIONS.map((option) => (
            <Pressable
              key={option}
              className="flex-row items-center justify-between px-4 py-3.5 active:bg-pressed"
              onPress={() => setPreference(option)}
              accessibilityRole="button"
              accessibilityState={{ selected: preference === option }}
            >
              <Text className="font-sans text-body text-fg">
                {t(`appearance.${option}`)}
              </Text>
              {preference === option ? (
                <Icon
                  name={{ ios: "checkmark", android: "check", web: "check" }}
                  tone="ink"
                  size="sm"
                />
              ) : null}
            </Pressable>
          ))}
        </ListGroup>
      </View>

      <View className="mt-8 px-4">
        <SectionHeader title={t("language.sectionTitle")} className="mb-4" />

        <ListGroup>
          {SUPPORTED_LANGUAGES.map((language) => (
            <Pressable
              key={language}
              className="flex-row items-center justify-between px-4 py-3.5 active:bg-pressed"
              onPress={() => handleSelectLanguage(language)}
              accessibilityRole="button"
              accessibilityState={{ selected: i18n.language === language }}
            >
              <Text className="font-sans text-body text-fg">
                {LANGUAGE_LABELS[language]}
              </Text>
              {i18n.language === language ? (
                <Icon
                  name={{ ios: "checkmark", android: "check", web: "check" }}
                  tone="ink"
                  size="sm"
                />
              ) : null}
            </Pressable>
          ))}
        </ListGroup>
      </View>

      <View className="mt-8 px-4">
        <SectionHeader
          title={t("notifications.sectionTitle")}
          className="mb-4"
        />

        <Card className="gap-3 p-4">
          <Text className="font-sans text-caption text-fg-secondary">
            {notificationStatus
              ? t(NOTIFICATION_STATUS_KEYS[notificationStatus])
              : ""}
          </Text>

          {notificationError ? (
            <FormMessage>{notificationError}</FormMessage>
          ) : null}

          <Button
            title={t("notifications.enable")}
            onPress={handleEnableNotifications}
            loading={registeringNotifications}
            variant="secondary"
          />
        </Card>
      </View>

      <View className="mt-8 px-4 pb-10">
        <SectionHeader title={t("account.sectionTitle")} className="mb-4" />

        <Card className="p-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-sans text-caption text-fg-secondary">{t("account.email")}</Text>
            <Text className="font-sans-medium text-caption text-fg">
              {user?.email || "N/A"}
            </Text>
          </View>
        </Card>

        {signOutError ? (
          <FormMessage className="mt-4 text-center">
            {signOutError}
          </FormMessage>
        ) : null}

        <View className="mt-4">
          <Button
            title={t("account.signOut")}
            variant="danger"
            onPress={handleSignOut}
          />
        </View>
      </View>
    </KeyboardAwareScrollView>

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

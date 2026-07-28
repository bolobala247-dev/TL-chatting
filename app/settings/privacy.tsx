import { useEffect, useState } from "react";
import { View, Text, Pressable, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/src/lib/keyboard";
import { useAuthStore } from "@/src/stores/authStore";
import { usePrivacyStore } from "@/src/stores/privacyStore";
import { appLockService } from "@/src/services/appLockService";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";
import { ListGroup } from "@/src/components/ui/Card";
import { SectionHeader } from "@/src/components/ui/SectionHeader";
import { TextField } from "@/src/components/ui/TextField";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { Spinner } from "@/src/components/ui/LoadingSpinner";
import { useThemeColors } from "@/src/theme";
import type { UpdateTables, VisibilityLevel } from "@/src/types";

// Which column a visibility picker edits, and the levels it offers.
// Options mirror the DB CHECK constraints (00010_privacy_controls.sql).
interface PickerTarget {
  field:
    | "last_seen_visibility"
    | "online_visibility"
    | "avatar_visibility"
    | "phone_visibility";
  options: VisibilityLevel[];
}

const PICKERS: Record<PickerTarget["field"], VisibilityLevel[]> = {
  last_seen_visibility: ["everyone", "contacts", "nobody"],
  online_visibility: ["everyone", "contacts", "nobody"],
  avatar_visibility: ["everyone", "contacts"],
  phone_visibility: ["contacts", "nobody"],
};

export default function PrivacySettingsScreen() {
  const { t } = useTranslation(["settings", "chat", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const userId = useAuthStore((s) => s.user?.id);
  const settings = usePrivacyStore((s) => s.settings);
  const loading = usePrivacyStore((s) => s.loading);
  const fetchSettings = usePrivacyStore((s) => s.fetchSettings);
  const updateSettings = usePrivacyStore((s) => s.updateSettings);

  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (userId && !settings) void fetchSettings(userId);
  }, [userId, settings, fetchSettings]);

  // Keep the phone field in sync once settings arrive (or across devices)
  useEffect(() => {
    setPhone(settings?.phone_number ?? "");
  }, [settings?.phone_number]);

  const applyUpdate = async (updates: UpdateTables<"privacy_settings">) => {
    if (!userId) return;
    setError("");
    try {
      await updateSettings(userId, updates);
    } catch (err) {
      console.error("[PrivacySettings] update", err);
      setError(t("privacy.updateFailed"));
    }
  };

  const handleSavePhone = () => {
    const trimmed = phone.trim();
    if (trimmed === (settings?.phone_number ?? "")) return;
    void applyUpdate({ phone_number: trimmed || null });
  };

  const visibilityLabel = (value: string) =>
    t(`privacy.visibility.${value as VisibilityLevel}`);

  const renderPickerRow = (
    field: PickerTarget["field"],
    label: string
  ) => (
    <Pressable
      className="flex-row items-center justify-between px-4 py-3.5 active:bg-pressed"
      onPress={() => setPicker({ field, options: PICKERS[field] })}
      disabled={!settings}
      accessibilityRole="button"
    >
      <Text className="font-sans text-body text-fg">{label}</Text>
      <View className="flex-row items-center gap-1.5">
        <Text className="font-sans text-caption text-fg-secondary">
          {settings ? visibilityLabel(settings[field]) : ""}
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
      </View>
    </Pressable>
  );

  const renderSwitchRow = (
    field: "read_receipts_enabled" | "typing_indicators_enabled",
    label: string,
    hint: string
  ) => (
    <View className="flex-row items-center justify-between gap-3 px-4 py-3.5">
      <View className="flex-1">
        <Text className="font-sans text-body text-fg">{label}</Text>
        <Text className="mt-0.5 font-sans text-label text-fg-tertiary">
          {hint}
        </Text>
      </View>
      <Switch
        value={settings ? settings[field] : true}
        onValueChange={(value) => void applyUpdate({ [field]: value })}
        disabled={!settings}
        trackColor={{ false: colors.disabled, true: colors.ink }}
        thumbColor={colors.surface}
      />
    </View>
  );

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 border-b border-divider bg-surface px-4 pb-3 pt-2">
        <Pressable
          onPress={() => router.back()}
          className="-ml-2 h-11 w-11 items-center justify-center rounded-full active:opacity-50"
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={t("chat:header.back")}
        >
          <Icon
            name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
            tone="primary"
            size={22}
          />
        </Pressable>
        <Text
          className="flex-1 font-sans-semibold text-body text-fg"
          numberOfLines={1}
        >
          {t("privacy.title")}
        </Text>
      </View>

      {loading && !settings ? (
        <Spinner fullScreen />
      ) : (
        <KeyboardAwareScrollView
          className="flex-1"
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
        >
          {error ? (
            <View className="px-4 pt-3">
              <FormMessage>{error}</FormMessage>
            </View>
          ) : null}

          <View className="mt-4 px-4">
            <SectionHeader
              title={t("privacy.activitySection")}
              className="mb-4"
            />
            <ListGroup>
              {renderPickerRow("last_seen_visibility", t("privacy.lastSeen"))}
              {renderPickerRow("online_visibility", t("privacy.onlineStatus"))}
            </ListGroup>
          </View>

          <View className="mt-8 px-4">
            <SectionHeader
              title={t("privacy.messagingSection")}
              className="mb-4"
            />
            <ListGroup>
              {renderSwitchRow(
                "read_receipts_enabled",
                t("privacy.readReceipts"),
                t("privacy.readReceiptsHint")
              )}
              {renderSwitchRow(
                "typing_indicators_enabled",
                t("privacy.typingIndicators"),
                t("privacy.typingIndicatorsHint")
              )}
            </ListGroup>
          </View>

          <View className="mt-8 px-4">
            <SectionHeader
              title={t("privacy.profileSection")}
              className="mb-4"
            />
            <ListGroup>
              {renderPickerRow("avatar_visibility", t("privacy.profilePhoto"))}
              {renderPickerRow("phone_visibility", t("privacy.phoneVisibility"))}
            </ListGroup>

            <View className="mt-4">
              <TextField
                label={t("privacy.phoneNumberLabel")}
                value={phone}
                onChangeText={setPhone}
                placeholder={t("privacy.phonePlaceholder")}
                keyboardType="phone-pad"
                returnKeyType="done"
                onSubmitEditing={handleSavePhone}
                onBlur={handleSavePhone}
              />
            </View>
          </View>

          <View className="mt-8 px-4 pb-10">
            <ListGroup>
              <Pressable
                className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
                onPress={() => router.push("/settings/blocked-users")}
                accessibilityRole="button"
              >
                <Icon
                  name={{
                    ios: "person.crop.circle.badge.xmark",
                    android: "block",
                    web: "block",
                  }}
                  tone="secondary"
                  size="md"
                />
                <Text className="flex-1 font-sans text-body text-fg">
                  {t("privacy.blocked.entry")}
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

              {appLockService.isSupported() ? (
                <Pressable
                  className="flex-row items-center gap-3 border-t border-divider px-4 py-3.5 active:bg-pressed"
                  onPress={() => router.push("/settings/app-lock")}
                  accessibilityRole="button"
                >
                  <Icon
                    name={{ ios: "lock", android: "lock", web: "lock" }}
                    tone="secondary"
                    size="md"
                  />
                  <Text className="flex-1 font-sans text-body text-fg">
                    {t("privacy.appLock.entry")}
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
              ) : null}
            </ListGroup>
          </View>
        </KeyboardAwareScrollView>
      )}

      <Sheet visible={!!picker} onClose={() => setPicker(null)}>
        {picker?.options.map((option, index) => {
          const selected = settings?.[picker.field] === option;
          return (
            <Pressable
              key={option}
              className={`flex-row items-center justify-between px-4 py-3.5 active:bg-pressed ${
                index > 0 ? "border-t border-divider" : ""
              }`}
              onPress={() => {
                setPicker(null);
                void applyUpdate({ [picker.field]: option });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text className="font-sans text-body text-fg">
                {visibilityLabel(option)}
              </Text>
              {selected ? (
                <Icon
                  name={{ ios: "checkmark", android: "check", web: "check" }}
                  tone="ink"
                  size="sm"
                />
              ) : null}
            </Pressable>
          );
        })}
      </Sheet>
    </View>
  );
}

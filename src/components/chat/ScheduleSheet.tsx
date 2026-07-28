import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";

interface ScheduleSheetProps {
  visible: boolean;
  /** Backdrop / back dismiss — the parent restores the composer draft. */
  onClose: () => void;
  /** Picking a preset — the parent schedules the draft and closes. */
  onPick: (date: Date) => void;
}

interface PresetOption {
  key: string;
  label: string;
  icon: IconName;
  date: Date;
}

function buildPresets(t: TFunction<"chat">): PresetOption[] {
  const now = Date.now();
  const clockIcon: IconName = {
    ios: "clock",
    android: "schedule",
    web: "schedule",
  };

  const tonight = new Date();
  tonight.setHours(20, 0, 0, 0);

  const tomorrowMorning = new Date();
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(8, 0, 0, 0);

  const presets: PresetOption[] = [
    {
      key: "in30m",
      label: t("schedule.in30m"),
      icon: clockIcon,
      date: new Date(now + 30 * 60 * 1000),
    },
    {
      key: "in1h",
      label: t("schedule.in1h"),
      icon: clockIcon,
      date: new Date(now + 60 * 60 * 1000),
    },
    {
      key: "in3h",
      label: t("schedule.in3h"),
      icon: clockIcon,
      date: new Date(now + 3 * 60 * 60 * 1000),
    },
    {
      key: "tonight",
      label: t("schedule.tonight"),
      icon: { ios: "moon", android: "dark_mode", web: "dark_mode" },
      date: tonight,
    },
    {
      key: "tomorrowMorning",
      label: t("schedule.tomorrowMorning"),
      icon: { ios: "sunrise", android: "wb_twilight", web: "wb_twilight" },
      date: tomorrowMorning,
    },
  ];

  // Drop presets that already passed (e.g. "tonight 20:00" at 21:30)
  return presets.filter((p) => p.date.getTime() > now + 60 * 1000);
}

/**
 * Preset picker shown after long-pressing the send button — schedules the
 * drafted message via `scheduled_messages` (delivered by pg_cron).
 */
export function ScheduleSheet({ visible, onClose, onPick }: ScheduleSheetProps) {
  const { t } = useTranslation("chat");
  const presets = buildPresets(t);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("schedule.title")}
        </Text>
      </View>

      {presets.map((preset) => (
        <Pressable
          key={preset.key}
          className="flex-row items-center gap-3 px-4 py-3.5 active:bg-pressed"
          onPress={() => {
            onPick(preset.date);
          }}
          accessibilityRole="button"
        >
          <Icon name={preset.icon} tone="secondary" size="md" />
          <Text className="flex-1 font-sans text-body text-fg">
            {preset.label}
          </Text>
          <Text className="font-sans text-label text-fg-tertiary">
            {preset.date.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </Pressable>
      ))}

      <View className="border-t border-divider px-4 py-3">
        <Text className="font-sans text-label leading-4 text-fg-tertiary">
          {t("schedule.hint")}
        </Text>
      </View>
    </Sheet>
  );
}

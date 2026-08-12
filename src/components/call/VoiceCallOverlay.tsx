import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/src/components/ui/Avatar";
import { useVoiceCallStore } from "@/src/stores/voiceCallStore";

const WHITE = "#FFFFFF";

export function VoiceCallOverlay() {
  const { t } = useTranslation("chat");
  const insets = useSafeAreaInsets();
  const peer = useVoiceCallStore((state) => state.peer);
  const phase = useVoiceCallStore((state) => state.phase);
  const direction = useVoiceCallStore((state) => state.direction);
  const micEnabled = useVoiceCallStore((state) => state.micEnabled);
  const speakerEnabled = useVoiceCallStore((state) => state.speakerEnabled);
  const error = useVoiceCallStore((state) => state.error);
  const audioPlaybackBlocked = useVoiceCallStore((state) => state.audioPlaybackBlocked);
  const accept = useVoiceCallStore((state) => state.accept);
  const decline = useVoiceCallStore((state) => state.decline);
  const end = useVoiceCallStore((state) => state.end);
  const toggleMic = useVoiceCallStore((state) => state.toggleMic);
  const toggleSpeaker = useVoiceCallStore((state) => state.toggleSpeaker);
  const resumeRemoteAudio = useVoiceCallStore((state) => state.resumeRemoteAudio);
  const retryCall = useVoiceCallStore((state) => state.retryCall);

  const incoming = direction === "incoming" && phase === "ringing";
  const status = incoming
    ? t("call.status.incomingAudio")
    : phase === "ringing"
      ? t("call.status.calling")
      : phase === "connecting"
        ? t("call.status.connecting")
        : t("call.status.connected");

  return (
    <Modal
      visible
      animationType={Platform.OS === "web" ? "none" : "slide"}
      transparent={Platform.OS === "web"}
      statusBarTranslucent
      onRequestClose={incoming ? decline : end}
    >
      <View className="flex-1 items-center justify-between bg-black px-6" style={{ paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }}>
        <View className="items-center">
          <Avatar uri={peer?.avatar} name={peer?.name} size={112} />
          <Text className="mt-6 font-sans-semibold text-headline text-white" numberOfLines={1}>
            {peer?.name}
          </Text>
          <Text className="mt-2 font-sans text-body text-white/70">{status}</Text>
          {error && <Text className="mt-3 text-center font-sans text-label text-red-300">{t(`call.error.${error}`, { defaultValue: t("call.error.connection") })}</Text>}
          {audioPlaybackBlocked && (
            <Pressable onPress={resumeRemoteAudio} className="mt-4 rounded-full bg-white/20 px-4 py-2">
              <Text className="font-sans-semibold text-label text-white">{t("call.actions.enableAudio")}</Text>
            </Pressable>
          )}
        </View>

        {incoming ? (
          <View className="w-full flex-row justify-around">
            <Action icon="phone.down.fill" androidIcon="call_end" label={t("call.actions.decline")} color="bg-red-500" onPress={decline} />
            <Action icon="phone.fill" androidIcon="call" label={t("call.actions.accept")} color="bg-green-500" onPress={accept} />
          </View>
        ) : (
          <View className="w-full flex-row items-center justify-around">
            {phase !== "ringing" && <Action icon={micEnabled ? "mic.fill" : "mic.slash.fill"} androidIcon={micEnabled ? "mic" : "mic_off"} label={t("call.controls.mic")} onPress={toggleMic} />}
            {phase !== "ringing" && Platform.OS !== "web" && <Action icon="speaker.wave.2.fill" androidIcon="volume_up" label={t("call.controls.speaker")} active={speakerEnabled} onPress={toggleSpeaker} />}
            <Action icon="phone.down.fill" androidIcon="call_end" label={t("call.controls.end")} color="bg-red-500" onPress={end} />
          </View>
        )}
        {error && direction === "outgoing" && phase === "ended" && (
          <Pressable onPress={retryCall} className="mb-4 rounded-full bg-white/20 px-5 py-3">
            <Text className="font-sans-semibold text-label text-white">{t("call.actions.retry")}</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

function Action({ icon, androidIcon, label, color = "bg-white/15", active = false, onPress }: { icon: string; androidIcon: string; label: string; color?: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className="items-center gap-2 active:opacity-70" accessibilityRole="button" accessibilityLabel={label}>
      <View className={`h-16 w-16 items-center justify-center rounded-full ${active ? "bg-white" : color}`}>
        <SymbolView name={{ ios: icon as any, android: androidIcon as any, web: androidIcon as any }} tintColor={active ? "#000000" : WHITE} size={26} />
      </View>
      <Text className="font-sans text-caption text-white/80">{label}</Text>
    </Pressable>
  );
}

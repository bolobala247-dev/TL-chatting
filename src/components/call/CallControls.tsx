import { Platform, Pressable, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { useCallStore } from "@/src/stores/callStore";
import { PIP_SUPPORTED } from "@/src/lib/webrtc";
import { callControlsRowStyle } from "./callLayout";

// The call surface is an immersive, always-dark scene, so its icons use
// fixed black/white rather than theme tones (which would flip in light mode).
const ICON_LIGHT = "#FFFFFF";
const ICON_DARK = "#000000";

interface ControlButtonProps {
  icon: SymbolViewProps["name"];
  label: string;
  /** Highlighted (filled) when the feature is active/toggled on. */
  active?: boolean;
  variant?: "default" | "danger";
  onPress: () => void;
}

function ControlButton({
  icon,
  label,
  active = false,
  variant = "default",
  onPress,
}: ControlButtonProps) {
  const bg =
    variant === "danger"
      ? "bg-red-500"
      : active
        ? "bg-white"
        : "bg-white/15";
  const tint =
    variant === "danger" ? ICON_LIGHT : active ? ICON_DARK : ICON_LIGHT;

  return (
    <Pressable
      onPress={onPress}
      className={`h-16 w-16 items-center justify-center rounded-full active:opacity-70 ${bg}`}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <SymbolView name={icon} tintColor={tint} size={26} />
    </Pressable>
  );
}

// In-call control dock. Adapts to audio vs video and to the call phase.
export function CallControls() {
  const { t } = useTranslation("chat");
  const callType = useCallStore((s) => s.callType);
  const phase = useCallStore((s) => s.phase);
  const micEnabled = useCallStore((s) => s.micEnabled);
  const cameraEnabled = useCallStore((s) => s.cameraEnabled);
  const speakerEnabled = useCallStore((s) => s.speakerEnabled);
  const isPipActive = useCallStore((s) => s.isPipActive);
  const toggleMic = useCallStore((s) => s.toggleMic);
  const toggleCamera = useCallStore((s) => s.toggleCamera);
  const toggleSpeaker = useCallStore((s) => s.toggleSpeaker);
  const switchCamera = useCallStore((s) => s.switchCamera);
  const setPipActive = useCallStore((s) => s.setPipActive);
  const endCall = useCallStore((s) => s.endCall);

  const isVideo = callType === "video";
  const canSwitchCamera = isVideo && Platform.OS !== "web";
  const rowStyle = callControlsRowStyle();

  const buttons = (
    <>
      <ControlButton
        icon={
          micEnabled
            ? { ios: "mic.fill", android: "mic", web: "mic" }
            : { ios: "mic.slash.fill", android: "mic_off", web: "mic_off" }
        }
        label={t("call.controls.mic")}
        active={!micEnabled}
        onPress={toggleMic}
      />

      {isVideo && (
        <ControlButton
          icon={
            cameraEnabled
              ? { ios: "video.fill", android: "videocam", web: "videocam" }
              : {
                  ios: "video.slash.fill",
                  android: "videocam_off",
                  web: "videocam_off",
                }
          }
          label={t("call.controls.camera")}
          active={!cameraEnabled}
          onPress={toggleCamera}
        />
      )}

      {canSwitchCamera && (
        <ControlButton
          icon={{
            ios: "arrow.triangle.2.circlepath.camera.fill",
            android: "cameraswitch",
            web: "cameraswitch",
          }}
          label={t("call.controls.switchCamera")}
          onPress={switchCamera}
        />
      )}

      {Platform.OS !== "web" && (
        <ControlButton
          icon={
            speakerEnabled
              ? { ios: "speaker.wave.2.fill", android: "volume_up", web: "volume_up" }
              : { ios: "speaker.fill", android: "hearing", web: "hearing" }
          }
          label={t("call.controls.speaker")}
          active={speakerEnabled}
          onPress={toggleSpeaker}
        />
      )}

      {isVideo && PIP_SUPPORTED && phase === "connected" && (
        <ControlButton
          icon={{
            ios: "pip.enter",
            android: "picture_in_picture_alt",
            web: "picture_in_picture_alt",
          }}
          label={t("call.controls.pip")}
          active={isPipActive}
          onPress={() => setPipActive(!isPipActive)}
        />
      )}

      <ControlButton
        icon={{ ios: "phone.down.fill", android: "call_end", web: "call_end" }}
        label={t("call.controls.end")}
        variant="danger"
        onPress={endCall}
      />
    </>
  );

  // Reanimated Animated.View has no NativeWind cssInterop — layout must be inline.
  if (Platform.OS === "web") {
    return <View style={rowStyle}>{buttons}</View>;
  }

  return (
    <Animated.View entering={FadeIn} style={rowStyle}>
      {buttons}
    </Animated.View>
  );
}

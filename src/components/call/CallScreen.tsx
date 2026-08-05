import { Modal, Platform, View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/src/components/ui/Avatar";
import { useLockBodyScroll } from "@/src/hooks/useLockBodyScroll";
import { useCallStore } from "@/src/stores/callStore";
import type { CallPhase } from "@/src/stores/callStore";
import type { CallStatus } from "@/src/types";
import {
  callColumnStyle,
  callControlsDockStyle,
  callIdentityStyle,
  callMainStyle,
  callRootStyle,
  callVideoHeaderStyle,
} from "./callLayout";
import { VideoStream } from "./VideoStream";
import { RemoteVideo } from "./RemoteVideo";
import { CallControls } from "./CallControls";
import { CallTimer } from "./CallTimer";

// The call scene is intentionally always-dark (immersive), so text is fixed
// white rather than a theme tone.
function statusLabel(
  t: ReturnType<typeof useTranslation<"chat">>["t"],
  phase: CallPhase,
  direction: "incoming" | "outgoing" | null,
  endReason: CallStatus | null
): string {
  if (phase === "ended") {
    if (endReason === "declined") return t("call.status.declined");
    if (endReason === "missed") return t("call.status.missed");
    return t("call.status.ended");
  }
  if (phase === "connecting") return t("call.status.connecting");
  if (phase === "ringing") {
    return direction === "outgoing"
      ? t("call.status.calling")
      : t("call.status.ringing");
  }
  return "";
}

// Full-screen in-call surface (outgoing + connected states). Incoming ringing
// is handled by IncomingCallOverlay; CallHost picks between them.
export function CallScreen() {
  const { t } = useTranslation("chat");
  const insets = useSafeAreaInsets();

  const phase = useCallStore((s) => s.phase);
  const direction = useCallStore((s) => s.direction);
  const endReason = useCallStore((s) => s.endReason);
  const callType = useCallStore((s) => s.callType);
  const peer = useCallStore((s) => s.peer);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const cameraEnabled = useCallStore((s) => s.cameraEnabled);
  const isFrontCamera = useCallStore((s) => s.isFrontCamera);
  const connectedAt = useCallStore((s) => s.connectedAt);

  useLockBodyScroll(true);

  const isVideo = callType === "video";
  const showRemoteVideo =
    isVideo && phase === "connected" && !!remoteStream;
  const showLocalVideo = isVideo && cameraEnabled && !!localStream;
  const connected = phase === "connected" && connectedAt != null;
  const showCenteredIdentity = !showRemoteVideo;
  const controlsBottomInset = insets.bottom + 24;

  return (
    <Modal
      visible
      animationType={Platform.OS === "web" ? "none" : "fade"}
      transparent={Platform.OS === "web"}
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <View style={callRootStyle()}>
        {/* Remote video fills the screen once media is flowing */}
        {showRemoteVideo && (
          <View
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              overflow: "hidden",
            }}
          >
            <RemoteVideo
              stream={remoteStream}
              objectFit="cover"
              style={{ flex: 1, width: "100%", height: "100%" }}
            />
          </View>
        )}

        {/* Audio calls (or before connect) still need the remote audio to
            play — a zero-size sink drives it on web; native routes it via
            the audio session regardless. */}
        {remoteStream && !showRemoteVideo && (
          <View
            style={{ width: 0, height: 0, opacity: 0 }}
            pointerEvents="none"
          >
            <VideoStream stream={remoteStream} style={{ flex: 1 }} />
          </View>
        )}

        <View style={callColumnStyle()}>
          <View
            style={[
              callMainStyle(),
              { paddingTop: insets.top + 16 },
            ]}
          >
            {showCenteredIdentity ? (
              <View style={callIdentityStyle()}>
                <Avatar uri={peer?.avatar} name={peer?.name} size={112} />
                <Text
                  className="mt-6 font-sans-semibold text-headline text-white"
                  numberOfLines={1}
                >
                  {peer?.name}
                </Text>
                {connected ? (
                  <CallTimer
                    connectedAt={connectedAt!}
                    className="mt-1 font-sans text-body text-white/70"
                  />
                ) : (
                  <Text className="mt-1 font-sans text-body text-white/70">
                    {statusLabel(t, phase, direction, endReason)}
                  </Text>
                )}
              </View>
            ) : (
              <>
                <View style={callVideoHeaderStyle()}>
                  <Text
                    className="font-sans-semibold text-headline text-white"
                    numberOfLines={1}
                  >
                    {peer?.name}
                  </Text>
                  {connected ? (
                    <CallTimer
                      connectedAt={connectedAt!}
                      className="mt-1 font-sans text-body text-white/70"
                    />
                  ) : (
                    <Text className="mt-1 font-sans text-body text-white/70">
                      {statusLabel(t, phase, direction, endReason)}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }} />
              </>
            )}
          </View>

          {/* Self-view — pinned top-right, mirrored for the front camera */}
          {showLocalVideo && (
            <View
              className="absolute right-4 h-40 w-28 overflow-hidden rounded-2xl border border-white/20 bg-black"
              style={{ top: insets.top + 16 }}
            >
              <VideoStream
                stream={localStream}
                mirror={isFrontCamera}
                objectFit="cover"
                style={{ flex: 1 }}
              />
            </View>
          )}

          {phase !== "ended" && (
            <View style={callControlsDockStyle(controlsBottomInset)}>
              <CallControls />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

import { Modal, View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/src/components/ui/Avatar";
import { useCallStore } from "@/src/stores/callStore";

// Immersive dark surface → fixed white icon tint (not a theme tone).
const ICON_LIGHT = "#FFFFFF";

interface AnswerButtonProps {
  icon: SymbolViewProps["name"];
  label: string;
  variant: "accept" | "decline";
  onPress: () => void;
}

function AnswerButton({ icon, label, variant, onPress }: AnswerButtonProps) {
  const bg = variant === "accept" ? "bg-green-500" : "bg-red-500";
  return (
    <Pressable
      onPress={onPress}
      className="items-center gap-2 active:opacity-70"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        className={`h-[72px] w-[72px] items-center justify-center rounded-full ${bg}`}
      >
        <SymbolView name={icon} tintColor={ICON_LIGHT} size={30} />
      </View>
      <Text className="font-sans text-caption text-white/80">{label}</Text>
    </Pressable>
  );
}

// Full-screen incoming-call prompt with accept / decline actions.
export function IncomingCallOverlay() {
  const { t } = useTranslation("chat");
  const insets = useSafeAreaInsets();

  const peer = useCallStore((s) => s.peer);
  const callType = useCallStore((s) => s.callType);
  const acceptCall = useCallStore((s) => s.acceptCall);
  const declineCall = useCallStore((s) => s.declineCall);

  const isVideo = callType === "video";

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      onRequestClose={declineCall}
    >
      <View
        className="flex-1 bg-black"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="flex-1 items-center justify-center px-8">
          <Avatar uri={peer?.avatar} name={peer?.name} size={128} />
          <Text
            className="mt-6 font-sans-semibold text-headline text-white"
            numberOfLines={1}
          >
            {peer?.name}
          </Text>
          <Text className="mt-2 font-sans text-body text-white/70">
            {t(
              isVideo
                ? "call.status.incomingVideo"
                : "call.status.incomingAudio"
            )}
          </Text>
        </View>

        <View className="flex-row items-center justify-around px-10 pb-6">
          <AnswerButton
            icon={{ ios: "phone.down.fill", android: "call_end", web: "call_end" }}
            label={t("call.actions.decline")}
            variant="decline"
            onPress={declineCall}
          />
          <AnswerButton
            icon={
              isVideo
                ? { ios: "video.fill", android: "videocam", web: "videocam" }
                : { ios: "phone.fill", android: "call", web: "call" }
            }
            label={t("call.actions.accept")}
            variant="accept"
            onPress={acceptCall}
          />
        </View>
      </View>
    </Modal>
  );
}

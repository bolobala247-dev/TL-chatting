import { Platform, type ViewStyle } from "react-native";

/** Root call surface — fills the RN Web modal container without double-sizing. */
export function callRootStyle(): ViewStyle {
  if (Platform.OS !== "web") return { flex: 1 };
  return {
    flex: 1,
    width: "100%",
    height: "100%",
    overflow: "hidden",
    backgroundColor: "#000000",
  };
}

/** Column shell that keeps children inside the viewport without scrolling. */
export function callColumnStyle(): ViewStyle {
  const base: ViewStyle = {
    flex: 1,
    width: "100%",
    flexDirection: "column",
  };
  return Platform.OS === "web"
    ? { ...base, minHeight: 0, overflow: "hidden" }
    : base;
}

/** Primary content region — grows/shrinks while controls stay pinned. */
export function callMainStyle(): ViewStyle {
  const base: ViewStyle = { flex: 1, width: "100%" };
  return Platform.OS === "web"
    ? { ...base, minHeight: 0, overflow: "hidden" }
    : base;
}

/** Centered avatar + identity block (audio / pre-connect). */
export function callIdentityStyle(): ViewStyle {
  return {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  };
}

/** Video-call name/timer header overlay. */
export function callVideoHeaderStyle(): ViewStyle {
  return {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 24,
  };
}

/** Bottom control dock — never scrolls, respects safe-area inset. */
export function callControlsDockStyle(bottomInset: number): ViewStyle {
  return {
    width: "100%",
    flexShrink: 0,
    paddingBottom: bottomInset,
    alignItems: "center",
  };
}

/**
 * Control button row — inline styles because Reanimated Animated.View has no
 * NativeWind cssInterop, so className layout utilities are ignored on web.
 */
export function callControlsRowStyle(): ViewStyle {
  return {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 24,
    flexShrink: 0,
  };
}

/** Incoming-call answer row. */
export function callAnswerRowStyle(): ViewStyle {
  return {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 40,
  };
}

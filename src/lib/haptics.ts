import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Thin web-safe wrappers — haptics only make sense on device,
// so every helper bails out early on web.

/** Light tick for selections (swipe threshold, pin toggle...). */
export function hapticSelection() {
  if (Platform.OS === "web") return;
  Haptics.selectionAsync().catch(() => {});
}

/** Medium impact for long-press menus opening. */
export function hapticImpact() {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

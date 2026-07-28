import { Pressable, type PressableProps } from "react-native";
import { Icon, type IconName, type IconTone } from "./Icon";
import { iconSize } from "@/src/theme";

interface IconButtonProps extends Omit<PressableProps, "children"> {
  icon: IconName;
  /** Required — icon-only controls must speak to screen readers. */
  accessibilityLabel: string;
  size?: keyof typeof iconSize | number;
  tone?: IconTone;
}

/**
 * 44pt icon-only button (DESIGN_SYSTEM.md §16) — guarantees touch target
 * and accessibility label in one place.
 */
export function IconButton({
  icon,
  accessibilityLabel,
  size = "md",
  tone = "secondary",
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      className={`h-11 w-11 items-center justify-center rounded-full active:bg-pressed ${disabled ? "opacity-50" : ""}`}
      disabled={disabled}
      {...props}
    >
      <Icon name={icon} size={size} tone={disabled ? "disabled" : tone} />
    </Pressable>
  );
}

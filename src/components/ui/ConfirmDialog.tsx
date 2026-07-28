import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Thin wrapper over `Dialog` — public API unchanged for existing callers. */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const confirmLabel = confirmText ?? t("actions.confirm");
  const cancelLabel = cancelText ?? t("actions.cancel");
  return (
    <Dialog
      visible={visible}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <View className="flex-1">
            <Button
              title={cancelLabel}
              variant="secondary"
              size="md"
              onPress={onCancel}
            />
          </View>
          <View className="flex-1">
            <Button
              title={confirmLabel}
              variant={destructive ? "danger" : "primary"}
              size="md"
              onPress={onConfirm}
            />
          </View>
        </>
      }
    >
      <Text className="font-sans text-body leading-6 text-fg-secondary">
        {message}
      </Text>
    </Dialog>
  );
}

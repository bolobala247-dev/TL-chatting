import { useState } from "react";
import { View, Text, TextInput, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { privacyService } from "@/src/services/privacyService";
import { Button } from "@/src/components/ui/Button";
import { Icon } from "@/src/components/ui/Icon";
import { Sheet } from "@/src/components/ui/Sheet";
import { FormMessage } from "@/src/components/ui/FormMessage";
import type { ReportReason } from "@/src/types";

const REPORT_REASONS: ReportReason[] = [
  "spam",
  "harassment",
  "hate",
  "scam",
  "other",
];

interface ReportUserSheetProps {
  visible: boolean;
  /** User being reported. */
  reportedUserId: string | null;
  /** Optional message evidence — snapshotted server-side by submit_report. */
  messageId?: string | null;
  onClose: () => void;
}

// Report flow: pick a reason, optional details, submit via the submit_report
// RPC (server validates shared room + snapshots the message content so the
// evidence survives a later recall).
export function ReportUserSheet({
  visible,
  reportedUserId,
  messageId,
  onClose,
}: ReportUserSheetProps) {
  const { t } = useTranslation(["chat", "common"]);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const resetAndClose = () => {
    setReason(null);
    setDetails("");
    setSubmitted(false);
    setError("");
    onClose();
  };

  const handleSubmit = async () => {
    if (!reportedUserId || !reason) return;
    setSubmitting(true);
    setError("");
    try {
      await privacyService.reportUser(reportedUserId, reason, {
        messageId: messageId ?? undefined,
        details: details.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      console.error("[ReportUserSheet] submit", err);
      setError(t("chat:report.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={resetAndClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("chat:report.title")}
        </Text>
      </View>

      {submitted ? (
        <View className="items-center gap-3 px-4 py-6">
          <Icon
            name={{
              ios: "checkmark.circle.fill",
              android: "check_circle",
              web: "check_circle",
            }}
            tone="ink"
            size="lg"
          />
          <Text className="text-center font-sans text-body text-fg">
            {t("chat:report.success")}
          </Text>
          <View className="w-full pt-2">
            <Button
              title={t("common:actions.close")}
              variant="secondary"
              size="md"
              onPress={resetAndClose}
            />
          </View>
        </View>
      ) : (
        <>
          {REPORT_REASONS.map((item) => (
            <Pressable
              key={item}
              className="flex-row items-center gap-3 px-4 py-3 active:bg-pressed"
              onPress={() => setReason(item)}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === item }}
            >
              <Icon
                name={
                  reason === item
                    ? {
                        ios: "largecircle.fill.circle",
                        android: "radio_button_checked",
                        web: "radio_button_checked",
                      }
                    : {
                        ios: "circle",
                        android: "radio_button_unchecked",
                        web: "radio_button_unchecked",
                      }
                }
                tone={reason === item ? "ink" : "tertiary"}
                size="md"
              />
              <Text className="font-sans text-body text-fg">
                {t(`chat:report.reasons.${item}`)}
              </Text>
            </Pressable>
          ))}

          <View className="border-t border-divider px-4 py-3">
            <TextInput
              className="min-h-[64px] rounded-xl border border-border bg-surface-secondary px-4 py-3 font-sans text-body text-fg"
              placeholder={t("chat:report.detailsPlaceholder")}
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={500}
            />
            {error ? <FormMessage className="mt-2">{error}</FormMessage> : null}
            <View className="mt-3">
              <Button
                title={t("chat:report.submit")}
                size="md"
                onPress={handleSubmit}
                loading={submitting}
                disabled={!reason}
              />
            </View>
          </View>
        </>
      )}
    </Sheet>
  );
}

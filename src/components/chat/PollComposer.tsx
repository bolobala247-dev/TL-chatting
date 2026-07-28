import { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { MAX_POLL_OPTIONS } from "@/src/lib/constants";
import { Button } from "@/src/components/ui/Button";
import { FormMessage } from "@/src/components/ui/FormMessage";
import { IconButton } from "@/src/components/ui/IconButton";
import { Sheet } from "@/src/components/ui/Sheet";
import { TextField } from "@/src/components/ui/TextField";

interface PollComposerProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (question: string, options: string[]) => void;
}

// Poll creation sheet: question + 2–10 options, inline validation
export function PollComposer({ visible, onClose, onSubmit }: PollComposerProps) {
  const { t } = useTranslation(["chat", "common"]);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [error, setError] = useState("");

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const updateOption = (index: number, text: string) => {
    setOptions((prev) => prev.map((o, i) => (i === index ? text : o)));
    if (error) setError("");
  };

  const addOption = () => {
    setOptions((prev) =>
      prev.length < MAX_POLL_OPTIONS ? [...prev, ""] : prev
    );
  };

  const removeOption = (index: number) => {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setError(t("chat:poll.questionRequired"));
      return;
    }

    const filledOptions = options.map((o) => o.trim()).filter(Boolean);
    if (filledOptions.length < 2) {
      setError(t("chat:poll.minOptions"));
      return;
    }

    onSubmit(trimmedQuestion, filledOptions);
    reset();
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={handleClose}>
      <View className="border-b border-divider px-4 py-3">
        <Text className="font-sans-semibold text-body text-fg">
          {t("chat:poll.create")}
        </Text>
      </View>

      <ScrollView
        className="max-h-96"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16 }}
      >
        <TextField
          label={t("chat:poll.questionLabel")}
          placeholder={t("chat:poll.questionPlaceholder")}
          value={question}
          onChangeText={(text) => {
            setQuestion(text);
            if (error) setError("");
          }}
          containerClassName="mb-3"
        />

        {options.map((option, index) => (
          <View key={index} className="mb-2 flex-row items-center gap-1">
            <TextField
              placeholder={t("chat:poll.optionPlaceholder", {
                index: index + 1,
              })}
              value={option}
              onChangeText={(text) => updateOption(index, text)}
              containerClassName="flex-1"
            />
            {options.length > 2 && (
              <IconButton
                icon={{ ios: "xmark", android: "close", web: "close" }}
                accessibilityLabel={t("chat:poll.removeOption")}
                size="sm"
                onPress={() => removeOption(index)}
              />
            )}
          </View>
        ))}

        {options.length < MAX_POLL_OPTIONS && (
          <Button
            title={t("chat:poll.addOption")}
            variant="ghost"
            size="md"
            onPress={addOption}
          />
        )}

        {error ? <FormMessage className="mt-1">{error}</FormMessage> : null}

        <View className="mt-3">
          <Button title={t("chat:poll.send")} onPress={handleSubmit} />
        </View>
      </ScrollView>
    </Sheet>
  );
}

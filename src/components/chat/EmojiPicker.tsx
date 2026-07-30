import { memo, useCallback, useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { FlashList, type ListRenderItemInfo } from "@shopify/flash-list";
import emojiGroups from "unicode-emoji-json/data-by-group.json";
import { Emoji } from "@/src/components/ui/Emoji";
import { Icon, type IconName } from "@/src/components/ui/Icon";
import { SearchField } from "@/src/components/ui/SearchField";
import { Sheet } from "@/src/components/ui/Sheet";
import { useEmojiStore } from "@/src/stores/emojiStore";

interface EmojiPickerProps {
  visible: boolean;
  onClose: () => void;
  /** Insert the picked emoji into the composer at the cursor. */
  onPick: (emoji: string) => void;
}

interface PickerEmoji {
  emoji: string;
  /** English CLDR name — used for search and accessibility. */
  name: string;
}

// Monochrome tab icons (DESIGN_SYSTEM.md §10) — the grid itself is the only
// colorful surface, keeping the picker chrome on-brand
const CATEGORY_ICONS = {
  smileys_emotion: { ios: "face.smiling", android: "mood", web: "mood" },
  people_body: { ios: "hand.wave", android: "waving_hand", web: "waving_hand" },
  animals_nature: { ios: "pawprint", android: "pets", web: "pets" },
  food_drink: { ios: "fork.knife", android: "restaurant", web: "restaurant" },
  travel_places: { ios: "car", android: "directions_car", web: "directions_car" },
  activities: { ios: "soccerball", android: "sports_soccer", web: "sports_soccer" },
  objects: { ios: "lightbulb", android: "emoji_objects", web: "emoji_objects" },
  symbols: { ios: "number", android: "emoji_symbols", web: "emoji_symbols" },
  flags: { ios: "flag", android: "flag", web: "flag" },
} as const satisfies Record<string, IconName>;

type CategorySlug = keyof typeof CATEGORY_ICONS;
type TabKey = "recent" | CategorySlug;

const RECENT_ICON: IconName = { ios: "clock", android: "schedule", web: "schedule" };

// Twemoji 15.1 (web renderer in Emoji.tsx) has no assets past Emoji 15.1,
// and newer glyphs also show as tofu on older devices — filter them out
const MAX_EMOJI_VERSION = 15.1;

// Computed once when the lazy chunk loads — never per render
const GROUPS = emojiGroups
  .filter((group) => group.slug in CATEGORY_ICONS)
  .map((group) => ({
    slug: group.slug as CategorySlug,
    emojis: group.emojis
      .filter((e) => parseFloat(e.emoji_version) <= MAX_EMOJI_VERSION)
      .map((e): PickerEmoji & { slug: string } => ({
        emoji: e.emoji,
        name: e.name,
        slug: e.slug,
      })),
  }));

const ALL_EMOJIS = GROUPS.flatMap((group) => group.emojis);
const TABS: TabKey[] = ["recent", ...GROUPS.map((group) => group.slug)];

const NUM_COLUMNS = 8;
const GRID_HEIGHT = 320;

const EmojiCell = memo(function EmojiCell({
  item,
  onPick,
}: {
  item: PickerEmoji;
  onPick: (emoji: string) => void;
}) {
  return (
    <Pressable
      className="h-11 flex-1 items-center justify-center rounded-xl active:bg-pressed"
      onPress={() => onPick(item.emoji)}
      accessibilityRole="button"
      accessibilityLabel={item.name}
    >
      <Emoji emoji={item.emoji} size={26} />
    </Pressable>
  );
});

function EmojiPicker({ visible, onClose, onPick }: EmojiPickerProps) {
  const { t } = useTranslation("chat");
  const recentEmojis = useEmojiStore((s) => s.recentEmojis);

  const [query, setQuery] = useState("");
  // First open lands on recents when there are any, else on smileys
  const [tab, setTab] = useState<TabKey>(() =>
    useEmojiStore.getState().recentEmojis.length > 0
      ? "recent"
      : "smileys_emotion"
  );

  const trimmedQuery = query.trim().toLowerCase();

  const data = useMemo<PickerEmoji[]>(() => {
    if (trimmedQuery) {
      return ALL_EMOJIS.filter(
        (e) => e.name.includes(trimmedQuery) || e.slug.includes(trimmedQuery)
      );
    }
    if (tab === "recent") {
      return recentEmojis.map((emoji) => ({ emoji, name: emoji }));
    }
    return GROUPS.find((group) => group.slug === tab)?.emojis ?? [];
  }, [trimmedQuery, tab, recentEmojis]);

  const handlePick = useCallback(
    (emoji: string) => {
      useEmojiStore.getState().addRecentEmoji(emoji);
      onPick(emoji);
    },
    [onPick]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PickerEmoji>) => (
      <EmojiCell item={item} onPick={handlePick} />
    ),
    [handlePick]
  );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View className="px-4 pb-2">
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={t("emoji.searchPlaceholder")}
        />
      </View>

      <View className="flex-row items-center gap-0.5 border-b border-divider px-3 pb-2">
        {TABS.map((key) => {
          const active = !trimmedQuery && tab === key;
          return (
            <Pressable
              key={key}
              className={`h-8 flex-1 items-center justify-center rounded-full ${
                active ? "bg-surface-secondary" : ""
              } active:bg-pressed`}
              onPress={() => {
                setQuery("");
                setTab(key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={
                key === "recent"
                  ? t("emoji.recent")
                  : t(`emoji.categories.${key}`)
              }
            >
              <Icon
                name={key === "recent" ? RECENT_ICON : CATEGORY_ICONS[key]}
                size="sm"
                tone={active ? "primary" : "tertiary"}
              />
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: GRID_HEIGHT }}>
        {data.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center font-sans text-caption text-fg-tertiary">
              {trimmedQuery ? t("emoji.noResults") : t("emoji.recentEmpty")}
            </Text>
          </View>
        ) : (
          <FlashList
            data={data}
            numColumns={NUM_COLUMNS}
            renderItem={renderItem}
            keyExtractor={(item) => item.emoji}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 8 }}
          />
        )}
      </View>
    </Sheet>
  );
}

// Memoized + default export: loaded via React.lazy from MessageInput so the
// dataset never touches the startup path
export default memo(EmojiPicker);

// Hand-written types for unicode-emoji-json (ships no .d.ts for deep
// imports) — also keeps tsc from inferring a literal type for the ~400KB JSON.
declare module "unicode-emoji-json/data-by-group.json" {
  interface UnicodeEmoji {
    emoji: string;
    skin_tone_support: boolean;
    name: string;
    slug: string;
    unicode_version: string;
    emoji_version: string;
  }

  interface UnicodeEmojiGroup {
    name: string;
    slug: string;
    emojis: UnicodeEmoji[];
  }

  const groups: UnicodeEmojiGroup[];
  export default groups;
}

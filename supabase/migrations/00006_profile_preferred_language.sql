-- i18n: store the user's preferred UI language on their profile so it
-- follows them across devices. NULL = no explicit choice (fall back to
-- the locally persisted setting, then the device language, then English).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_language TEXT;

COMMENT ON COLUMN public.profiles.preferred_language IS
  'BCP-47 language code chosen in Settings (e.g. en, vi, ja). NULL = follow device/local setting.';

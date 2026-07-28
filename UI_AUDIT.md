# Talo — Complete UI Audit

Version 1.0 · Static code audit (no code was modified) · Scope: `app/**`, `src/components/**`, `tailwind.config.ts`, `global.css`

> Screenshots are not included — this is a static audit of the codebase. Every finding below references exact files and lines so it can be verified without running the app.

---

## 0. Executive Summary

| Metric | Result |
|--------|--------|
| Screens audited | 11 (`login`, `register`, `forgot-password`, `reset-password`, `messages`, `contacts`, `settings`, `chat/[roomId]`, `+not-found`, `index`, root layout) |
| Reusable components audited | 14 (5 `ui/`, 7 `chat/`, 2 `rooms/`) |
| Findings | 34 |
| Critical | 4 |
| High | 11 |
| Medium | 13 |
| Low | 6 |

**The single most important finding:** `BRAND_GUIDELINE.md` defines a premium **monochrome (black/white), Inter-based, Scandinavian** identity — but the entire UI is built on a **blue Tailwind palette (`#2563EB`)**, bright multicolor avatars, emoji icons, and heavy colored shadows. The app and the brand are two different products today.

**Second most important:** there is **no theming system**. `bg-white`, `text-gray-900` and ~30 hardcoded hex values are scattered across every file. Dark mode is impossible without a token layer.

---

## 1. Critical Findings

### C1 — UI contradicts the Talo brand (monochrome → blue)
- **Where:** everywhere. `tailwind.config.ts` defines `primary` as Tailwind Blue. Used in `Button`, `MessageBubble` (own bubble = `bg-primary-600`), FAB (`app/(tabs)/index.tsx:78`), tab bar active tint `#2563EB`, links, badges, checkmarks, register title (`text-primary-600`).
- **Why critical:** `BRAND_GUIDELINE.md §6` — "The identity is monochrome-first… Accent: none by default." The product looks like a generic blue Material messenger, exactly the feeling the brand forbids.
- **Recommendation:** replace `primary` with a monochrome accent (`accent = black` in light, `white` in dark) via semantic tokens.
- **Migration difficulty:** Medium (mechanical once tokens exist; contrast must be re-verified per surface).

### C2 — No theming system / no dark mode
- **Where:** `global.css` (3 lines, no tokens), `tailwind.config.ts` (no semantic colors, no `darkMode` strategy), every screen hardcodes `bg-white`. `StatusBar style="auto"` in `app/_layout.tsx` will already mismatch on dark-system devices since all screens render light.
- **Recommendation:** CSS-variable semantic tokens + NativeWind `useColorScheme` + persisted preference + `ThemeProvider`.
- **Difficulty:** Medium-High (foundation work, touches config + every file, but each edit is mechanical).

### C3 — ~30 hardcoded hex colors in JSX/props
- **Where (non-exhaustive):**
  - `placeholderTextColor="#9CA3AF"` ×7 (`login`, `register` ×2, `forgot-password`, `settings`, `contacts`, `CreateRoomModal`, `PasswordInput`, `MessageInput`)
  - `tintColor`: `#9CA3AF`, `#D1D5DB`, `#2563EB`, `#374151`, `#DC2626`, `#FFFFFF`, `#1D4ED8` across `SymbolView` usages
  - Spinners: `#3B82F6` (`LoadingSpinner:11`, `MessageList:34,46`, `Button:47`, `RefreshControl` in `(tabs)/index.tsx:70`)
  - Nav: `#2563EB`, `#9CA3AF`, `#F1F5F9`, `#FFFFFF` in `(tabs)/_layout.tsx`; `#FFFFFF` in `(auth)/_layout.tsx`
  - Shadow: `shadowColor: "#2563EB"` on the FAB
- **Recommendation:** every color must resolve from a theme token object (for props) or a semantic class (for `className`). Zero raw hex outside the token definition file.
- **Difficulty:** Low per instance, High in volume — perfect candidate for phase-by-phase migration.

### C4 — Brand font (Inter) is never loaded
- **Where:** `app/_layout.tsx:48-50` loads only `SpaceMono` (which is **used nowhere**). All text renders in system default (San Francisco / Roboto) — Roboto on Android gives precisely the "Material feeling" the brief forbids.
- **Recommendation:** load Inter (400/500/600) via `@expo-google-fonts/inter`, set as default font family token; drop the dead SpaceMono asset.
- **Difficulty:** Low.

---

## 2. High Findings

### H1 — Multicolor avatar palette violates monochrome identity
- `src/components/ui/Avatar.tsx:20-29`: 8 bright colors (`bg-blue-500`, `bg-green-500`, `bg-purple-500`, `bg-orange-500`, `bg-pink-500`…). This is the loudest anti-brand element in every list row.
- **Fix:** monochrome initials (grayscale tonal steps, or black-on-gray-100 / white-on-gray-800). Difficulty: Low.

### H2 — Emoji used as icons
- `register.tsx:90` `✉️`, `forgot-password.tsx:51` `✉️`, `reset-password.tsx:123` `✅`, `settings.tsx:193` `📷` (camera badge on avatar).
- Emoji render differently per OS, cannot be themed, and read as amateur next to a premium identity.
- **Fix:** replace with icon system glyphs. Difficulty: Low.

### H3 — Heavy colored shadow on FAB
- `app/(tabs)/index.tsx:80-86`: blue shadow, `opacity 0.3`, `radius 8`, `elevation 8` + `shadow-lg` class (double shadow). Brief: "No Heavy Shadow", brand: "no shadows".
- **Fix:** flat FAB (solid ink tile, hairline border in dark), elevation token ≤ subtle. Difficulty: Low.

### H4 — No `TextField` component; input styles duplicated 9×
- The exact string `h-12 rounded-xl border bg-gray-50 px-4 text-base text-gray-900` (+ error variant) is copy-pasted in `login.tsx`, `register.tsx` ×2, `forgot-password.tsx`, `settings.tsx`, `chat/[roomId].tsx` (edit modal), `PasswordInput.tsx` — while `CreateRoomModal` and `contacts.tsx` use a *different* input style (`h-10 rounded-xl bg-gray-100`, no border). Two competing input languages.
- **Fix:** one `TextField` (with `label`, `error`, `helper`) + one `SearchField`. Difficulty: Medium.

### H5 — Button hierarchy bypassed by inline buttons
- `Button.tsx` exists, but raw `Pressable` buttons re-implement it in: `ConfirmDialog.tsx:49-68`, edit modal in `chat/[roomId].tsx:295-311` (identical dialog-footer pair, duplicated), sign-out in `settings.tsx:324-331` (a fourth, "danger-tinted" variant that exists nowhere else), selected-user chips, language rows.
- Also: `Button` spinner color hardcodes `#3B82F6` — which never matches its own `bg-primary-600` (`#2563EB`).
- **Fix:** extend `Button` (`variant: primary/secondary/ghost/danger`, `size: sm/md/lg`) and use it everywhere. Difficulty: Medium.

### H6 — Success/error/info feedback text duplicated ~15× with drifting styles
- `text-sm text-red-600` inline error appears in every form, sometimes `mt-1.5`, sometimes `mt-2`, sometimes bare; success is `text-sm text-green-600` (`settings.tsx:235`) — `green-600` appears exactly once in the app (untokenized semantic color). Chat error banner (`chat/[roomId].tsx:224`) is a third pattern.
- **Fix:** `FieldError` / `FormMessage` component + semantic `success/danger` tokens. Difficulty: Low.

### H7 — Empty states: four different patterns
| Screen | Pattern |
|--------|---------|
| Rooms (`(tabs)/index.tsx:40`) | icon 64 `#D1D5DB` + `text-lg gray-500` + `text-sm gray-400` |
| Contacts (`contacts.tsx:127`) | icon 48 `#D1D5DB` + single `text-sm gray-400`, `pt-20` |
| Messages (`MessageList.tsx:50`) | no icon, `text-base gray-400` + `text-sm gray-300` |
| CreateRoomModal (`:226`) | no icon, single `text-sm gray-400`, `py-10` |
- **Fix:** one `EmptyState` component (icon, title, subtitle, optional action). Difficulty: Low.

### H8 — Success screens duplicated 3× (register / forgot / reset)
- Near-identical 15-line blocks: centered emoji + title + body + full-width button (`register.tsx:87-107`, `forgot-password.tsx:48-67`, `reset-password.tsx:120-138`).
- **Fix:** one `StatusScreen`/`SuccessState` component. Difficulty: Low.

### H9 — Icon system is fragmented and Material-flavored
- `expo-symbols` renders **SF Symbols on iOS but filled Material icons on Android/web** (`plus.circle.fill` → `add_circle`), so Android/web users get exactly the Material feel the brief forbids. Mixed metaphors too: back arrow is `chevron.left` (iOS) vs `arrow_back` (Android). Sizes vary 12/16/18/20/22/24/48/64 with no scale; tints hardcoded per callsite.
- **Fix:** unified icon component wrapping a single stroke-based set (e.g. Lucide: thin, rounded, consistent 2px stroke — matches the pill geometry of the Talo mark) with size + tone tokens. Difficulty: Medium (new dependency — flagged for approval).

### H10 — Navigation chrome inconsistent
- Tab screens use native headers (`fontSize 18 / 700`, hex colors in `(tabs)/_layout.tsx`); chat uses a custom `ChatHeader` (different height, typography `text-base font-semibold`); auth screens have no header; the modal (`CreateRoomModal`) has a third header pattern (Cancel / title / `width:40` spacer hack).
- **Fix:** shared header tokens (height, title style, hairline) applied to both native options and custom headers. Difficulty: Medium.

### H11 — Accessibility is near-absent
- Only 1 `accessibilityLabel` in the entire codebase (`PasswordInput`). No `accessibilityRole="button"` anywhere; icon-only Pressables (back button, FAB, send, attach, dismiss-reply, avatar chips) are unlabeled for screen readers.
- Touch targets below 44pt: `ReplyPreview` dismiss (`p-1` ≈ 24pt), `ChatHeader` back (22pt glyph, no padding), selected-user chip remove (12pt icon).
- No `prefers-reduced-motion` handling (TypingIndicator loops forever).
- Contrast failures: `text-gray-400` on white (2.8:1) used for timestamps/status/empty text — below WCAG AA 4.5:1; `text-gray-300` (1.9:1) in `MessageList:58`; `text-blue-200` timestamps on `primary-600` bubbles ≈ 2.4:1.
- **Fix:** labels + roles pass, hitSlop/44pt minimum, tokenized text tones that pass AA, reduced-motion guard. Difficulty: Medium.

---

## 3. Medium Findings

### M1 — Typography has no scale
Arbitrary sizes everywhere: `text-[15px]` (bubbles, inputs, rows), `text-[10px]` (timestamps), `text-[11px]` (badge), `text-4xl/2xl/xl/lg/base/sm/xs` mixed ad hoc. Same semantic element differs across screens — e.g. auth titles: login `text-4xl font-bold text-black`, register `text-4xl font-bold text-primary-600`, forgot/reset `text-2xl font-bold text-gray-900`. Three title styles, three colors.
**Fix:** typography tokens (Display/Title/Body/Caption/Label) as reusable classes or a `Text` wrapper.

### M2 — Border radius drift
`rounded-lg` (reply context), `rounded-xl` (inputs, buttons, cards), `rounded-2xl` (bubbles, dialogs, message input pill), `rounded-md` corner override (bubble tail), `rounded-full` (chips, FAB, avatar), `borderRadius: 3` (flag). No documented scale.
**Fix:** radius tokens: `sm 8 / md 12 / lg 16 / full`.

### M3 — Spacing off the 4/8pt grid
Mostly Tailwind 4pt steps, but: `min-h-[36px]` (MessageInput), `min-h-[88px]` (edit modal), `w-9/h-9` (36px buttons), `size={52}`/`48`/`44`/`90` avatars, `top: insets.top + 12`, `mb-1.5/py-3.5/px-3.5` half-steps mixed freely with whole steps in sibling elements.
**Fix:** 8pt scale with 4pt half-step allowed only for icon/text gaps; avatar size tokens (`sm 32 / md 40 / lg 48 / xl 88`).

### M4 — Screen padding inconsistent
Auth screens `px-6`; tabs/list rows `px-4`; chat bubbles `px-3`; settings sections `px-4`; success screens `px-6`. No documented page-margin rule.

### M5 — Dialog patterns duplicated & divergent
`ConfirmDialog` (centered card, `bg-black/50`, `shadow-xl`) vs edit-message modal in `chat/[roomId].tsx:262-314` (full re-implementation of the same card) vs `MessageActions` (bottom sheet, `bg-black/40` — different scrim) vs `CreateRoomModal` (fullscreen slide). Scrim opacity, radius, padding and footers all drift.
**Fix:** `Dialog` + `Sheet` primitives sharing scrim/radius/motion tokens; edit-modal reuses `Dialog`.

### M6 — `shadow-xl` on dialogs contradicts flat design
`ConfirmDialog.tsx:40` and the edit modal use `shadow-xl`. Brief: flat, no heavy shadow. Replace with hairline border + subtle elevation token.

### M7 — Loading states: 5 variations
`LoadingSpinner` component (blue default) vs raw `ActivityIndicator` in `MessageList` (×2), `Button`, `RefreshControl` tint; "..." text string as loading indicator on the avatar badge (`settings.tsx:193`); `search.searching` text row in two other places. No skeletons anywhere.
**Fix:** single `Spinner` token-colored component; text-based "…" removed; (optional later: skeleton rows for lists).

### M8 — `FlatList` used where project rules mandate `@shopify/flash-list`
`MessageList.tsx`, `(tabs)/index.tsx`, `contacts.tsx`, `CreateRoomModal.tsx`. FlashList v2 is already a dependency. (Behavior-neutral swap, but it *is* a runtime change — scheduled as its own low-risk step.)

### M9 — Unread badge & status metadata micro-styles
Badge: `text-[11px] font-bold`, `min-w-[20px]`, `px-1.5 py-0.5` — one-off. Timestamp `text-[10px]`; "edited" flag same. All need Caption/Label tokens.

### M10 — Room row title hierarchy encoded by font-weight deltas only
`RoomListItem.tsx:50`: unread = `font-bold text-gray-900`, read = `font-medium text-gray-800` — two adjacent grays with no semantic meaning. Should be `text-primary` vs `text-secondary` tokens + weight.

### M11 — Message bubble details
- Reply context inside bubble uses `bg-black/5` + `border-primary-300` — on a blue bubble this is illegible in some cases; timestamps `text-blue-200` are accent-coupled.
- Image size hardcoded `220×180` — not responsive to bubble max width (`max-w-[80%]`).
- Bubble radius `rounded-2xl` + `rounded-br-md` tail — fine, but must be tokenized so dark mode variants stay in sync.

### M12 — `ChatHeader` back button metaphor + safe area
Back glyph differs per platform (chevron vs arrow); header sits under a manual `paddingTop: insets.top` wrapper in the screen while tab screens rely on native headers — heights don't match visually.

### M13 — Responsive rules absent
No `max-w` container on web/tablet: chat list, settings and auth forms stretch edge-to-edge on desktop (Vercel web deploy exists, so web matters). Only `ConfirmDialog`/edit modal use `max-w-sm`.
**Fix:** page container token (`max-w` breakpoints) for web/tablet.

---

## 4. Low Findings

| # | Finding | Where |
|---|---------|-------|
| L1 | Dead asset: SpaceMono font loaded, never referenced by any style | `app/_layout.tsx`, `assets/fonts/` |
| L2 | `surface.dark: #1E293B` token defined but never used | `tailwind.config.ts:27` |
| L3 | Language toggle chip on login is a bespoke pattern (flag + pill); settings uses a list — two switcher UIs | `login.tsx:67-80`, `settings.tsx:255-276` |
| L4 | `View style={{ width: 40 }}` spacer hack for header centering | `CreateRoomModal.tsx:163` |
| L5 | Avatar camera badge uses `border-white` (breaks on future dark bg) + emoji + "..." loading text | `settings.tsx:191-195` |
| L6 | `+html.tsx` `theme-color #000000` is the only place that matches the brand | `app/+html.tsx:20` |

---

## 5. Duplication Map (what becomes a shared component)

| Duplicated pattern | Occurrences | Target component |
|---|---|---|
| Labeled text input + error | 9 | `TextField` |
| Search input pill | 2 (contacts, CreateRoomModal) | `SearchField` |
| Dialog card + footer button pair | 2 (ConfirmDialog, edit modal) | `Dialog` (+ `Button`) |
| Success screen (emoji/title/body/CTA) | 3 | `StatusScreen` |
| Empty state | 4 | `EmptyState` |
| Inline field/form error text | ~15 | `FormMessage` |
| Section header (uppercase gray label) | 4 (settings) | `SectionHeader` |
| Settings card (`rounded-xl border bg-gray-50`) | 3 | `Card` / `ListGroup` |
| Icon-only pressable (back, send, attach, dismiss…) | 7 | `IconButton` |
| Inline "button-like" Pressables | 6 | `Button` variants |
| Unread badge | 1 (+ future) | `Badge` |

---

## 6. What is already good (do not touch unnecessarily)

- Clean architecture: screens → hooks → stores/services is respected; the redesign never needs to touch business logic.
- `Button`, `Avatar`, `ConfirmDialog`, `PasswordInput`, `LoadingSpinner` already exist as shared components — they need retheming/extension, not rewriting.
- Optimistic sends, realtime, i18n (en/vi) fully working — all UI strings already externalized, which makes copy-safe redesign easy.
- Chat bubble layout (mine right / theirs left, tail radius, reply preview, typing indicator) is structurally sound — only tokens/colors change.
- `BRAND_GUIDELINE.md` is excellent and becomes the design-system source of truth; assets (SVG masters, icons) already exist.
- `expo-image`, safe-area handling, keyboard avoidance are correctly used.

---

## 7. Severity → Phase mapping

Full sequencing lives in `UI_MIGRATION_PLAN.md`. Summary:

| Severity | Findings | Resolved in phase |
|---|---|---|
| Critical | C1–C4 | Phase 1 (foundation) + mechanical rollout in 2–6 |
| High | H1–H11 | Phases 2–6 |
| Medium | M1–M13 | Phases 2–6 |
| Low | L1–L6 | Opportunistic, inside whichever phase touches the file |

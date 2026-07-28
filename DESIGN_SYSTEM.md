# Talo Design System

Version 1.0 · Companion to `BRAND_GUIDELINE.md` (brand is the source of truth; this document translates it into product UI)

---

## 1. Brand Philosophy

Talo means **"house"** in Finnish — a home for conversation. The product must feel the way a well-built Scandinavian house feels: quiet, warm, structural, nothing decorative that doesn't serve.

**One sentence:** *Conversation without noise.*

The UI is monochrome-first. Content (messages, names, photos) provides all the color; the chrome never competes with it. This is the same reasoning behind Linear's gray discipline, Notion's paper-like surfaces, and Apple's material restraint.

## 2. Design Principles

1. **Ink on paper** — UI is black ink on white paper (inverted at night). Accent color is *ink itself*: the strongest element on screen is the most important one.
2. **Hierarchy through tone, not hue** — importance is expressed with the gray scale and weight, never with color.
3. **Hairlines, not shadows** — separation comes from 1px borders and tonal steps. Elevation exists only for overlays, and it is whisper-quiet.
4. **The grid is invisible but absolute** — 8pt spacing, 4pt half-steps for icon/text gaps only.
5. **Motion is physics, not decoration** — short, eased, interruptible; nothing bounces, nothing loops for attention.
6. **Consistency over creativity** — a screen that already conforms is left alone.

## 3. Visual Identity in Product

- Logo usage follows `BRAND_GUIDELINE.md` (§2–§7). In-app, the wordmark appears **only** on the login screen; everywhere else the product speaks through typography.
- The pill geometry of the mark (fully rounded rects) echoes through the UI: pill search fields, pill chips, pill FAB, stadium-shaped send button.
- No gradients, no glass, no blur backgrounds, no colored glows. Ever.

---

## 4. Color System

### 4.1 Primitive scale (gray, neutral — slightly cool like the brand's silence)

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| `gray-50` | `#FAFAFA` | | `gray-500` | `#737373` |
| `gray-100` | `#F5F5F5` | | `gray-600` | `#525252` |
| `gray-200` | `#E5E5E5` | | `gray-700` | `#404040` |
| `gray-300` | `#D4D4D4` | | `gray-800` | `#262626` |
| `gray-400` | `#A3A3A3` | | `gray-900` | `#171717` |
| `black` | `#000000` | | `gray-950` | `#0A0A0A` |
| `white` | `#FFFFFF` | | | |

Status primitives (desaturated, never bright — used *only* through semantic tokens below):

| | Light mode value | Dark mode value |
|---|---|---|
| red (danger) | `#B91C1C` (text) / `#FEF2F2` (bg) | `#F87171` / `#2A1212` |
| green (success) | `#15803D` / `#F0FDF4` | `#4ADE80` / `#0F2417` |
| amber (warning) | `#A16207` / `#FFFBEB` | `#FBBF24` / `#271E0B` |
| blue (info) | `#1D4ED8` / `#EFF6FF` | `#60A5FA` / `#11203A` |

### 4.2 Semantic tokens (the only names allowed in product code)

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `white` | `gray-950` | Screen background |
| `surface` | `white` | `gray-950` | Headers, tab bar, composer |
| `surface-secondary` | `gray-50` | `gray-900` | Grouped cards, input fill, incoming bubble bg base |
| `card` | `gray-50` | `gray-900` | Settings cards, list groups |
| `border` | `gray-200` | `gray-800` | Input borders, card borders |
| `divider` | `gray-100` | `gray-900` | Hairlines between rows/sections |
| `ink` | `black` | `white` | **The accent.** Primary buttons, FAB, own bubble, active tab, links |
| `ink-inverse` | `white` | `black` | Text/icons on `ink` |
| `text-primary` | `gray-900` | `gray-50` | Titles, names, message text |
| `text-secondary` | `gray-600` | `gray-400` | Subtitles, previews, body-secondary |
| `text-tertiary` | `gray-500` | `gray-500` | Timestamps, metadata (smallest AA-passing tone) |
| `placeholder` | `gray-400` | `gray-600` | Input placeholders only (exempt from AA as placeholder) |
| `disabled` | `gray-300` | `gray-700` | Disabled fills/text |
| `hover` | `gray-50` | `gray-900` | Web hover fill |
| `pressed` | `gray-100` | `gray-800` | Pressed/active fill |
| `success` / `success-bg` | table 4.1 | table 4.1 | Confirmation text/banners |
| `warning` / `warning-bg` | " | " | Warnings |
| `danger` / `danger-bg` | " | " | Errors, destructive actions |
| `info` / `info-bg` | " | " | Informational notices |
| `scrim` | `black/40` | `black/60` | Modal overlays |

**Rules**
- Product code references **semantic tokens only**. Raw hex or `gray-*` primitives in a screen/component is a lint-able violation.
- `ink` is the only "brand accent". A blue link or blue button must never appear.
- Own message bubble = `ink` bg + `ink-inverse` text. Incoming bubble = `surface-secondary` + `text-primary`. This is the signature look of Talo chat.

## 5. Typography

**Typeface: Inter** (per `BRAND_GUIDELINE.md §8`) — engineered for screens at 13–16px, geometric-humanist forms that echo the pill mark, variable, SIL-licensed. Loaded via `@expo-google-fonts/inter` (weights 400/500/600/700). Fallback: system stack.

| Role | Size/Line | Weight | Tracking | Usage |
|---|---|---|---|---|
| `display` | 32/38 | 700 | -1% | Login wordmark area, marketing |
| `headline` | 24/30 | 600 | -0.5% | Screen titles (auth) |
| `title` | 17/22 | 600 | 0 | Nav titles, dialog titles, row names |
| `body` | 15/21 | 400 | 0 | Messages, inputs, list previews |
| `body-strong` | 15/21 | 500 | 0 | Unread previews, emphasis |
| `caption` | 13/17 | 400 | 0 | Subtitles, helper/error text |
| `label` | 12/15 | 500 | +1% | Section headers (uppercase), badges, timestamps context |
| `micro` | 11/13 | 500 | +1% | In-bubble timestamps, unread badge |
| `button` | 15/20 | 600 | 0 | All buttons |
| `code` | 13/18 mono | 400 | 0 | Debug/technical only (system mono) |

One scale, no `text-[15px]` ad-hoc values in code — the scale is registered in Tailwind as `text-body`, `text-title`, etc.

## 6. Spacing & Grid

8pt system. Allowed steps: `2, 4` (micro — icon/text gaps only), `8, 12, 16, 24, 32, 40, 48, 64`.

| Token | Value | Canonical use |
|---|---|---|
| `space-1` | 4 | Icon↔label gap |
| `space-2` | 8 | Intra-row gaps, bubble inner Y |
| `space-3` | 12 | Bubble inner X, chip padding |
| `space-4` | 16 | **Screen horizontal padding (all screens)**, row padding |
| `space-6` | 24 | Section gaps, auth form padding |
| `space-8` | 32 | Between major blocks |
| `space-10` | 40 | Auth header ↔ form |

Grid: single column on mobile. On ≥768px web/tablet, page content is centered in a `max-w-[640px]` column (chat max `768px`).

## 7. Elevation

Flat by default. Only two levels exist:

| Token | Use | Recipe |
|---|---|---|
| `elevation-0` | Everything on the page | none — hairline `divider`/`border` separates |
| `elevation-overlay` | Dialogs, sheets, menus | `shadow: 0 8px 24px black/8%` (light) / hairline `border` + no shadow (dark) |

Never: colored shadows, `shadow-xl`, elevation on buttons/FAB/cards.

## 8. Radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 8 | Reply-context block, small controls |
| `radius-md` | 12 | Inputs, buttons, cards, list groups |
| `radius-lg` | 16 | Dialogs, sheets, message bubbles |
| `radius-full` | 999 | Avatars, chips, pills, FAB, search field |

Bubble tail: `radius-lg` with the trailing corner reduced to `radius-sm` (mine: bottom-right; theirs: bottom-left).

## 9. Motion & Animation

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 120ms | Press feedback, hover |
| `duration-base` | 200ms | Fades, theme cross-fade, dialog in |
| `duration-slow` | 300ms | Sheet slide, screen transitions |
| `easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Everything |
| `easing-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Dismissals |

Micro-interactions:
- **Press:** background steps to `pressed` token + `opacity 0.9`, 120ms. No scale-bounce.
- **Hover (web):** `hover` fill, 120ms.
- **Focus (keyboard/web):** 2px `ink` ring, offset 2px — visible on every interactive element.
- **Dialog:** fade + 4px rise, 200ms. **Sheet:** slide up, 300ms.
- **New message:** subtle fade-in (no slide chains). **Typing dots:** existing loop, gated by reduced-motion.
- **Reduced motion:** all durations → 0, loops disabled, cross-fades become cuts (`useReducedMotion` from reanimated).

## 10. Iconography

- **Library:** Lucide (`lucide-react-native`) — thin 2px stroke, rounded caps/joins, geometric — the closest open set to the pill DNA of the Talo mark. One set on all platforms (replaces `expo-symbols`, which renders filled Material icons on Android/web).
- **Stroke:** 2px at 24, never mixed with filled variants (exception: FAB plus and send arrow render on `ink` fill).
- **Sizes:** `icon-sm 16`, `icon-md 20`, `icon-lg 24`, `icon-empty 56` (empty states).
- **Tones:** icons use text tokens (`text-secondary` default, `text-tertiary` metadata, `ink-inverse` on fills).
- Delivered through one `Icon` component; raw library imports in screens are forbidden.

## 11. Illustrations & Empty States

No illustrations — the brand carries no imagery. Empty states are typographic:

```
[icon-empty, text-tertiary]
Title        — title, text-primary
Subtitle     — caption, text-secondary, max 2 lines, centered
[optional Button, secondary, mt space-6]
```

One `EmptyState` component. Copy is calm and directive ("Chưa có cuộc trò chuyện nào" / "Bắt đầu cuộc trò chuyện đầu tiên").

## 12. Loading States

- One `Spinner` (tinted `text-tertiary`; `ink-inverse` inside primary buttons).
- Full-screen loads: centered spinner on `background`.
- Lists: spinner footer row when paginating.
- Buttons: label swaps to spinner, width preserved.
- No text ellipsis ("...") as loading indicator.

## 13. Error States

- **Field error:** `caption` in `danger` under the field, `space-1` gap; field border becomes `danger`.
- **Form error:** same style above the submit button.
- **Success message:** `caption` in `success`.
- **Contextual banner (chat):** `danger-bg` strip with `danger` caption, hairline top border.
- All rendered by one `FormMessage` component (`tone: danger | success | info`). No `Alert.alert` (project rule).

## 14. Responsive Rules

| Breakpoint | Behavior |
|---|---|
| < 640 (mobile) | Full-bleed, tab bar bottom |
| 640–1024 (tablet/foldable) | Content column `max-w-640`, centered; touch targets unchanged |
| > 1024 (desktop web) | Same centered column (chat 768); hover states active; focus rings on |
| Foldables | Treated as tablet ≥ 640dp; no dual-pane in v1 (out of scope — behavior change) |

Safe areas respected via `react-native-safe-area-context` everywhere (already done — keep).

## 15. Dark Mode / Light Mode Rules

- **Light:** paper white `background`, ink black accents — the brand's positive mark.
- **Dark:** near-black `gray-950` (never pure `#000` for surfaces — reserves true black for OLED media), white ink. Use `*-white.svg` brand assets.
- Semantic tokens are the *only* switch — components contain zero `dark:` forks except through tokens.
- **System / manual / persisted:** `ThemeProvider` reads system scheme, allows `light | dark | system` override, persists in AsyncStorage, applies before first paint (read synchronously with splash screen still visible → **no flash**).
- Theme change animates via a 200ms cross-fade; `StatusBar` and Android nav bar follow the theme.
- Every screen and component must render correctly in both modes before its migration phase is "done".

## 16. Component Guidelines (library contract)

All shared components live in `src/components/ui/`. Screens compose them; screens never re-implement them.

| Component | Spec |
|---|---|
| `Button` | Variants `primary` (ink fill), `secondary` (surface-secondary + border), `ghost` (text ink), `danger` (danger-bg + danger text). Sizes `md 44` / `lg 48`. Radius `md`. Loading state built-in. |
| `IconButton` | 44×44 target, `radius-full`, ghost by default; required `accessibilityLabel`. |
| `TextField` | Label (caption/500), 48h, `radius-md`, `surface-secondary` fill + `border`; focus = `ink` border; error = `danger` border + `FormMessage`. |
| `PasswordInput` | `TextField` + trailing visibility `IconButton`. |
| `SearchField` | Pill (`radius-full`), 40h, leading search icon, `surface-secondary`, no border. |
| `FormMessage` | Caption, tones danger/success/info. |
| `Card` / `ListGroup` | `card` bg, `radius-md`, `border`; `ListGroup` renders rows with `divider` hairlines. |
| `ListRow` | 44+ h, `space-4` padding, pressed state, optional leading avatar / trailing accessory. |
| `Avatar` | Sizes `sm 32 / md 40 / lg 48 / xl 88`. Fallback: initials, `surface-secondary` bg + `text-secondary` (monochrome — no color hashing). |
| `Badge` | `micro` text, `ink` bg + `ink-inverse` (unread), `radius-full`, min-w 20. |
| `Dialog` | Centered, `max-w-sm`, `radius-lg`, `elevation-overlay`, scrim token; footer = `Button` pair (ghost + primary/danger). |
| `Sheet` | Bottom, `radius-lg` top corners, grabber, `elevation-overlay`; rows are `ListRow`. Used by MessageActions. |
| `EmptyState` | See §11. |
| `Spinner` | See §12. |
| `SectionHeader` | `label` uppercase `text-tertiary`, `space-4` × `space-2` padding. |
| `Icon` | Lucide wrapper, size/tone tokens. |
| `StatusScreen` | Icon + headline + body + CTA (register/forgot/reset success). |
| `SegmentedControl` (theme picker) | Pill track `surface-secondary`, active segment `surface` + border, 200ms slide. |
| **Chat set** | `MessageBubble` (ink/surface-secondary per §4.2), `ReplyPreview`, `TypingIndicator` (existing, retinted), `UnreadBadge` (=Badge), `Composer` (MessageInput: pill field + ink send stadium). |

Not built until a real screen needs one (no speculative components): Toast/Snackbar, Tooltip, Checkbox, Radio, Switch, Dropdown, Progress, Skeleton, Voice/Reaction bubbles. Their tokens above already define how they must look when needed.

## 17. Accessibility

- **Contrast:** all text tokens pass WCAG AA on their paired surfaces (`text-tertiary` `gray-500` on white = 4.6:1). `placeholder` is exempt per spec but stays ≥ 3:1.
- **Touch targets:** ≥ 44×44 (IconButton enforces; hitSlop where geometry is smaller).
- **Screen reader:** every icon-only control has `accessibilityLabel` (translated); `accessibilityRole` on buttons/links/headers; dialogs trap focus on web.
- **Keyboard (web):** visible `ink` focus ring, Esc closes dialogs/sheets, Enter submits forms.
- **Reduced motion:** honored globally (§9).
- **Large text:** typography uses `allowFontScaling` (default on); layouts must survive 1.3× scaling.

## 18. Do & Don't

**Do**
- ✓ Use semantic tokens for every color, radius, space, duration
- ✓ Express hierarchy with gray tone + weight
- ✓ Separate with hairlines
- ✓ Reuse `ui/` components; extend them rather than fork
- ✓ Verify both themes + AA before closing a phase

**Don't**
- ✗ Raw hex, `gray-*` primitives, or `text-[Npx]` in screens
- ✗ Blue accents, colored shadows, glassmorphism, gradients
- ✗ Filled/Material icons, emoji as icons
- ✗ `Alert.alert`, bouncy/looping attention animation
- ✗ New one-off buttons, inputs, dialogs, or empty states
- ✗ Redesign a screen that already conforms

# Talo — UI Migration Plan

Version 1.0 · Requires approval before any code is modified.

Governing constraints (from the brief + project rules):
- **No business logic changes.** Hooks, stores, services, Supabase calls are untouched in every phase.
- **No behavior changes.** Same navigation, same data flow, same interactions — only presentation, tokens, and component structure change.
- **Small phases, commit per phase**, `npx tsc --noEmit` + `npx expo export -p web` (build check) green after each phase, both themes verified.
- A screen already conforming to the design system is skipped.

---

## Prerequisites (need your approval — new dependencies)

| Package | Why | Alternative if declined |
|---|---|---|
| `@expo-google-fonts/inter` + `expo-font` (already present) | Brand font (BRAND_GUIDELINE §8) | Keep system fonts (weakens brand, C4 stays open) |
| `lucide-react-native` (+ `react-native-svg`) | Unified thin-stroke icon set on all platforms (H9) | Keep `expo-symbols` and accept Material icons on Android/web |

No other new dependencies. Reanimated (motion) and AsyncStorage (theme persistence) are already installed.

---

## Phase 1 — Foundation: Theme, Tokens, Typography *(no visual change yet except font)*

**Scope**
- `tailwind.config.ts`: replace blue `primary`/`surface` with the full semantic token set from `DESIGN_SYSTEM.md §4` (CSS-variable-backed, `darkMode: "class"` via NativeWind vars), typography scale (§5), radius/spacing/duration tokens.
- `global.css`: define light/dark CSS variable blocks.
- New `src/theme/`: `tokens.ts` (JS-side token object for props like `tintColor`, `placeholderTextColor`, nav options), `ThemeProvider.tsx` + `useTheme()` (system detection, manual override `light|dark|system`, AsyncStorage persistence, applied pre-first-paint under splash → no flash), `useThemeColors()`.
- Load Inter 400/500/600/700 in `app/_layout.tsx`; remove dead SpaceMono; set Inter as default font family token.
- Wire `ThemeProvider` into root layout; `StatusBar` follows theme.
- **Compatibility bridge:** keep old class names (`primary-600` etc.) temporarily aliased to new values so unmigrated screens keep compiling — removed in Phase 6.

**Files:** `tailwind.config.ts`, `global.css`, `app/_layout.tsx`, `src/theme/*` (new), `package.json`.
**Estimate:** 0.5–1 day. **Risk:** Medium (touches root layout & build config; NativeWind var setup is the trickiest step). **Rollback:** revert commit — no other file depends on new tokens yet.
**Expected impact:** app renders identically except Inter font; theme infrastructure ready; dark mode exists but is only reachable via system setting until Phase 5 adds the switch.

## Phase 2 — Core Component Library

**Scope** (all in `src/components/ui/`, retheme/extend — not rewrite)
- `Button`: monochrome variants (`primary`=ink, `secondary`, `ghost`, `danger`), token spinner color (fixes mismatched `#3B82F6`).
- `TextField` (new — consolidates the 9 duplicated input styles), `PasswordInput` refactored onto it, `SearchField` (new), `FormMessage` (new).
- `IconButton` (new, 44pt + required a11y label), `Icon` (new Lucide wrapper).
- `Avatar`: monochrome fallback (removes 8-color hashing), size tokens.
- `Spinner` (rename/retheme `LoadingSpinner`, keep old export as alias until Phase 6), `Badge`, `EmptyState`, `SectionHeader`, `Card`/`ListGroup`, `StatusScreen`, `Dialog` (generalizes `ConfirmDialog` — `ConfirmDialog` becomes a thin wrapper, its API unchanged so callers don't break), `Sheet`.
- Accessibility built into each: roles, labels, focus ring, 44pt targets.

**Files:** `src/components/ui/*` (5 modified, ~10 new).
**Estimate:** 1–1.5 days. **Risk:** Low-Medium (components not yet consumed by new screens; existing consumers keep working because public props are preserved). **Rollback:** revert commit; screens still reference old props.
**Expected impact:** existing screens already pick up monochrome Button/Avatar/Dialog/Spinner — first visible brand shift.

## Phase 3 — Auth Screens + Navigation Chrome

**Scope**
- `login/register/forgot/reset`: swap inline inputs → `TextField`, errors → `FormMessage`, success blocks → `StatusScreen` (kills emoji ✉️/✅), unify titles to `headline` token, language chip retinted, links → ink.
- Login shows the Talo wordmark asset instead of plain text (brand §12).
- `(tabs)/_layout.tsx`: tab bar + headers from tokens (active = ink, hairline divider, Inter titles); `(auth)/_layout.tsx` background token.
- `+not-found.tsx` tokens.

**Files:** 5 auth files, 2 layouts, `+not-found.tsx`.
**Estimate:** 0.5–1 day. **Risk:** Low (forms are simple; validation logic untouched). **Rollback:** per-file revert.
**Expected impact:** first fully on-brand screens; app entry feels premium immediately.

## Phase 4 — Chat: List, Messages, Composer

**Scope**
- `RoomListItem`: `ListRow` structure, `Badge` unread, tonal hierarchy tokens.
- `(tabs)/index.tsx`: `EmptyState`, flat ink FAB (removes blue double-shadow), token `RefreshControl`.
- `MessageBubble`: ink/surface-secondary bubbles, token timestamps (fixes `text-blue-200` contrast), reply-context retheme, responsive image width.
- `MessageList`: token spinners/empty state; **optional sub-step (flagged):** FlatList → FlashList per project rule M8 — done as its own commit so it can be reverted independently.
- `MessageInput` → Composer spec, `ChatHeader` tokens + `IconButton` back, `ReplyPreview`, `TypingIndicator` (reduced-motion gate), `MessageActions` → `Sheet`, edit-message modal → `Dialog` (removes the duplicated inline dialog), `chat/[roomId].tsx` error banner → `FormMessage` tones.
- `CreateRoomModal`: `SearchField`, chips retinted, header pattern fixed (no width-40 hack).

**Files:** 7 chat components, 2 rooms components, `app/chat/[roomId].tsx`, `app/(tabs)/index.tsx`.
**Estimate:** 1–1.5 days. **Risk:** Medium (highest-traffic surface; inverted list + optimistic sends must be regression-tested — logic untouched but retested). **Rollback:** per-file revert; FlashList sub-step reverts alone.
**Expected impact:** the signature Talo look lands; chat is the product.

## Phase 5 — Contacts, Settings, Profile + Theme Switch UI

**Scope**
- `contacts.tsx`: `SearchField`, `ListRow`, `EmptyState`.
- `settings.tsx`: `SectionHeader`, `ListGroup` rows (language list), `Card`, avatar camera badge → `IconButton` + `Spinner` (kills 📷 and "..."), sign-out → `Button danger`, messages → `FormMessage`.
- **New:** "Giao diện" section — `SegmentedControl` (Sáng / Tối / Hệ thống) wired to `ThemeProvider` (+ vi/en locale keys — additive only).
- Verify every screen in both themes; fix stragglers.

**Files:** `contacts.tsx`, `settings.tsx`, locale files (additive keys), `SegmentedControl` (new).
**Estimate:** 0.5–1 day. **Risk:** Low. **Rollback:** per-file revert.
**Expected impact:** theming user-facing and complete; settings reads like a system app.

## Phase 6 — Polish, Cleanup, Final Review

**Scope**
- Remove Phase 1 compatibility aliases + `LoadingSpinner` alias; grep-verify **zero** raw hex / `primary-*` blue / `text-[Npx]` outside `src/theme`.
- Micro-interactions pass: press/hover/focus states, dialog/sheet motion tokens, message fade-in — all reduced-motion-gated.
- Responsive pass: centered `max-w` columns on web/tablet (auth 640, chat 768).
- Accessibility pass: labels/roles audit, touch targets, AA spot-check both themes, font-scaling smoke test.
- Final review checklist (below); update `.qoder/rules`/`AGENTS.md` cross-reference if component conventions changed.

**Estimate:** 0.5–1 day. **Risk:** Low. **Rollback:** per-commit.

---

## Totals & Risk Summary

| Phase | Est. | Risk | Visible change |
|---|---|---|---|
| 1 Foundation | 0.5–1d | Medium | Font only |
| 2 Components | 1–1.5d | Low-Med | Monochrome primitives |
| 3 Auth + Nav | 0.5–1d | Low | Auth/brand entry |
| 4 Chat | 1–1.5d | Medium | Core product look |
| 5 Settings + Theme UI | 0.5–1d | Low | Dark-mode switch |
| 6 Polish | 0.5–1d | Low | Consistency lock |
| **Total** | **4.5–7 days** | | |

**Per-phase gate (every phase):** `npx tsc --noEmit` clean → web export builds → manual smoke of touched screens in light+dark → commit (`design-system: phase N — …`). Business-logic files (`src/hooks`, `src/stores`, `src/services`, `src/lib`, `supabase/`) show **zero diffs** across all phases — verified at each commit.

**Global rollback strategy:** one commit per phase (FlashList as an extra sub-commit) → any phase reverts cleanly without touching others; Phase 1's bridge means even a mid-migration state always compiles and runs.

## Final Review Checklist (exit criteria)

- ✓ Visual consistency across all 11 screens — one product
- ✓ Zero hardcoded colors outside `src/theme` / `tailwind.config.ts`
- ✓ Zero duplicated input/dialog/empty/success patterns
- ✓ Theme switch (system/manual/persisted, no flash) works on every screen
- ✓ Responsive columns on web/tablet
- ✓ AA contrast + labels + 44pt targets + reduced motion
- ✓ No perf regressions (list virtualization intact, no extra renders from ThemeProvider — token object memoized)
- ✓ Brand: monochrome, Inter, hairlines, flat — comparable to Apple/Linear/Notion restraint

---

## ⏸ Awaiting approval

Nothing beyond the three documents has been created. Approve to start, and please decide:
1. **Approve plan as-is?** (or adjust phase order/scope)
2. **Fonts:** add `@expo-google-fonts/inter`? (recommended)
3. **Icons:** add `lucide-react-native` + `react-native-svg`? (recommended; otherwise keep expo-symbols)
4. **FlashList swap** inside Phase 4: include or defer?

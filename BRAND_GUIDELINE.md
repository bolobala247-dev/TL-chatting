# Talo — Brand Guideline

Version 1.0 · July 2026

---

## 1. Brand Philosophy

**Talo** is a real-time messaging platform built on one idea: *conversation without noise*.

The identity is engineered around four values:

| Value | Design expression |
|-------|-------------------|
| Fast | One stroke weight, zero ornament — the mark is read in a single glance |
| Simple | Three geometric shapes; nothing can be removed |
| Trust & privacy | Pure monochrome — no trend colors, nothing to hide behind |
| Premium | Strict grid, optical spacing, timeless geometry |

*Talo* means **"house"** in Finnish — a home for conversation. The brand embodies
Scandinavian simplicity: quiet, functional, and durable.

---

## 2. The Symbol — "The Beam"

The Talo symbol is a capital **T** built from three pill shapes:

```
▬▬   |   ▬▬     ← two pills = two voices, two people
     |
     |          ← the stem = the direct channel between them
     |
```

- The **two horizontal pills** represent two people in dialogue.
- The **vertical stem passing between them** is the channel — direct,
  uninterrupted communication.
- Together they form the letter **T** for Talo.

It deliberately avoids the generic speech bubble while still speaking about
connection.

### Construction

Master grid: **512 × 512**, content area 416 × 384.

| Token | Value |
|-------|-------|
| Stroke weight | 88 units |
| Corner radius | 44 units (fully rounded pill) |
| Gap (crossbar ↔ stem) | 32 units — exactly 1 px at 16 × 16 |
| Crossbar pill | 132 × 88 |
| Stem | 88 × 384 |

All geometry is defined by whole units on the grid. Never redraw the mark —
always use the master SVGs in `design-assets/brand/svg/`.

---

## 3. The Wordmark

The wordmark **talo** is custom-drawn — it is not a font. It is constructed from
the same DNA as the symbol:

- Stroke weight 72 with fully round terminals
- Perfect-circle bowls (`a`, `o`), r = 84 (center-line)
- Single-storey `a` — geometric, friendly, unmistakable
- Lowercase only: approachable, modern, confident

Never retype the wordmark in a font. Use
`talo-wordmark-black.svg` / `talo-wordmark-white.svg`.

---

## 4. Logo Lockups

| Lockup | File | Use |
|--------|------|-----|
| Horizontal | `talo-logo-horizontal-*.svg` | Website header, docs, email |
| Vertical | `talo-logo-vertical-*.svg` | Splash screens, posters, packaging |
| Symbol only | `talo-symbol-*.svg` | Avatars, favicons, small spaces |
| Wordmark only | `talo-wordmark-*.svg` | Editorial contexts where the symbol already appears |

In the horizontal lockup the symbol height equals the full ascender-to-baseline
height of the wordmark, separated by a fixed gap equal to the symbol stroke × 1.1.

---

## 5. Safe Area & Minimum Size

**Safe area:** keep a clear space of at least **one stem-width (the "beam
unit")** on all sides of any lockup. Nothing may enter this zone — text, edges,
other logos.

**Minimum sizes:**

| Asset | Digital | Print |
|-------|---------|-------|
| Symbol | 16 px | 5 mm |
| Horizontal lockup | 80 px wide | 25 mm |
| Vertical lockup | 48 px wide | 15 mm |

Below 24 px, always prefer the symbol over any lockup.

---

## 6. Color Palette

The identity is **monochrome-first**. It must work with two colors only.

| Role | Hex | Usage |
|------|-----|-------|
| Talo Black | `#000000` | Primary — logo, text, icon tiles |
| Talo White | `#FFFFFF` | Secondary — backgrounds, reversed logo |

**Accent:** none by default. If a product accent is unavoidable (e.g. links,
focus states), it must never be applied to the logo or wordmark.

### Light mode
- Background `#FFFFFF`, logo and text `#000000`.

### Dark mode
- Background `#000000`, logo and text `#FFFFFF`.
- Use the `*-white.svg` masters — never CSS-invert the black files.

---

## 7. App Icon & Favicon

| Context | Composition |
|---------|-------------|
| iOS / store icon (1024) | White symbol at 51 % width on full-bleed black square — OS applies the mask |
| Android adaptive | Foreground: white symbol in the 66 % safe zone · Background: solid black · Monochrome: same foreground (system tints it) |
| Favicon / browser tab | Black rounded-square tile (radius 22 %) with white symbol — legible on both light and dark tab bars |
| Notification (Android status bar) | White symbol on transparency (`notification-icon.png`) |

Never place the bare black symbol on transparency as an app icon — always use
the tile so the icon holds its shape on any wallpaper.

---

## 8. Typography

**Brand font: [Inter](https://rsms.me/inter/)** (SIL Open Font License).

Why Inter fits Talo:

1. **Engineered for screens** — tall x-height and open apertures keep chat UI
   legible at 13–16 px, exactly where a messenger lives.
2. **Geometric-humanist balance** — its round, quiet forms echo the pill
   geometry of the symbol without copying it.
3. **Timeless, not trendy** — the same reason the palette is monochrome.
4. **Variable & open-source** — one file, every weight, no licensing risk.

| Role | Weight | Tracking |
|------|--------|----------|
| Display / headings | Inter SemiBold (600) | -1 % |
| Body / UI | Inter Regular (400) | 0 |
| Captions / labels | Inter Medium (500) | +1 % |

Fallback stack: `Inter, -apple-system, "Segoe UI", Roboto, sans-serif`.

---

## 9. Do & Don't

**Do**

- ✓ Use the provided SVG masters at all times
- ✓ Use black on white, or white on black
- ✓ Scale proportionally from the master files
- ✓ Use the symbol alone when space is tight

**Don't**

- ✗ Add gradients, shadows, outlines, or 3D effects
- ✗ Recolor the mark (including accent colors)
- ✗ Rotate, skew, stretch, or change stroke weights
- ✗ Rebuild the wordmark with a typeface
- ✗ Place the logo on photos or busy backgrounds without a solid tile
- ✗ Combine the symbol with a speech bubble or any extra shape

---

## 10. Accessibility

- Black on white is contrast ratio **21 : 1** — passes WCAG AAA everywhere.
- Never present the logo in a gray below `#595959` on white (4.5 : 1 floor).
- The app icon's white-on-black symbol remains legible for all color-vision
  deficiencies because the identity carries no hue information.
- Provide `alt="Talo"` for logo images; the symbol alone is `alt="Talo logo"`.

---

## 11. Asset Index

```
design-assets/brand/
├── svg/                              # editable vector masters (Figma-ready)
│   ├── talo-symbol-black.svg         # symbol, positive
│   ├── talo-symbol-white.svg         # symbol, reversed
│   ├── talo-wordmark-black.svg       # custom wordmark, positive
│   ├── talo-wordmark-white.svg       # custom wordmark, reversed
│   ├── talo-logo-horizontal-*.svg    # horizontal lockups
│   ├── talo-logo-vertical-*.svg      # vertical lockups
│   ├── talo-appicon.svg              # 1024 full-bleed icon tile
│   ├── talo-android-foreground.svg   # adaptive icon foreground
│   ├── talo-android-background.svg   # adaptive icon background
│   ├── talo-favicon.svg              # rounded favicon tile
│   ├── talo-launcher-round.svg       # legacy round launcher
│   ├── talo-og-image.svg             # Open Graph 1200×630
│   └── talo-twitter-card.svg         # Twitter card 1200×600
└── png/                              # exported rasters (regenerate, don't edit)
```

Regenerate every raster (app icons, favicons, Android res, PWA, social):

```bash
npm i --no-save sharp @resvg/resvg-js png-to-ico
node scripts/build-brand-assets.js
```

---

## 12. Examples

- **Browser tab:** black rounded tile + white T — reads at 16 px.
- **Android home screen:** black adaptive icon, white beam centered; monochrome
  layer follows the system theme (Material You).
- **Login screen:** wordmark or "Talo" text in black on white, tagline in gray.
- **Social share:** light OG card (black lockup on white) and dark Twitter card
  (white lockup on black) — the pair demonstrates the monochrome system.

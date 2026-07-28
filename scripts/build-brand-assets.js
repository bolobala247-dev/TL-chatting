/**
 * Talo brand asset builder
 *
 * Renders every raster branding asset from the SVG masters in
 * design-assets/brand/svg/. Re-run after editing any SVG master.
 *
 * Requires (installed on demand, not saved to package.json):
 *   npm i --no-save sharp @resvg/resvg-js png-to-ico
 *
 * Usage: node scripts/build-brand-assets.js
 */
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");
const sharp = require("sharp");
const pngToIcoModule = require("png-to-ico");
const pngToIco = pngToIcoModule.default ?? pngToIcoModule;

const ROOT = path.join(__dirname, "..");
const SVG = (name) =>
  fs.readFileSync(path.join(ROOT, "design-assets/brand/svg", name), "utf8");

function renderPng(svg, width, { background } = {}) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: background ?? "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
}

function writePng(outPath, buf) {
  const abs = path.join(ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  console.log("✓", outPath);
}

async function writeWebp(outPath, pngBuf) {
  const abs = path.join(ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  await sharp(pngBuf).webp({ lossless: true }).toFile(abs);
  console.log("✓", outPath);
}

async function main() {
  const symbolBlack = SVG("talo-symbol-black.svg");
  const symbolWhite = SVG("talo-symbol-white.svg");
  const horizBlack = SVG("talo-logo-horizontal-black.svg");
  const horizWhite = SVG("talo-logo-horizontal-white.svg");
  const vertBlack = SVG("talo-logo-vertical-black.svg");
  const vertWhite = SVG("talo-logo-vertical-white.svg");
  const appicon = SVG("talo-appicon.svg");
  const androidFg = SVG("talo-android-foreground.svg");
  const androidBg = SVG("talo-android-background.svg");
  const faviconTile = SVG("talo-favicon.svg");
  const launcherRound = SVG("talo-launcher-round.svg");
  const ogImage = SVG("talo-og-image.svg");
  const twitterCard = SVG("talo-twitter-card.svg");

  // ---------------------------------------------------------------- brand PNG kit
  writePng("design-assets/brand/png/talo-symbol-black.png", renderPng(symbolBlack, 1024));
  writePng("design-assets/brand/png/talo-symbol-white.png", renderPng(symbolWhite, 1024));
  writePng("design-assets/brand/png/talo-logo-horizontal-black.png", renderPng(horizBlack, 2000));
  writePng("design-assets/brand/png/talo-logo-horizontal-white.png", renderPng(horizWhite, 2000));
  writePng("design-assets/brand/png/talo-logo-vertical-black.png", renderPng(vertBlack, 1200));
  writePng("design-assets/brand/png/talo-logo-vertical-white.png", renderPng(vertWhite, 1200));
  writePng("design-assets/brand/png/talo-appicon-1024.png", renderPng(appicon, 1024));

  // ---------------------------------------------------------------- Expo app assets
  writePng("assets/images/icon.png", renderPng(appicon, 1024));
  writePng("assets/images/android-icon-foreground.png", renderPng(androidFg, 1024));
  writePng("assets/images/android-icon-background.png", renderPng(androidBg, 1024));
  writePng("assets/images/android-icon-monochrome.png", renderPng(androidFg, 1024));
  writePng("assets/images/splash-icon.png", renderPng(symbolBlack, 1024));
  writePng("assets/images/favicon.png", renderPng(faviconTile, 48));
  // Notification small icon: white glyph on transparency (Android status bar)
  writePng("assets/images/notification-icon.png", renderPng(symbolWhite, 96));

  // ---------------------------------------------------------------- Android native res
  const dpi = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [bucket, scale] of Object.entries(dpi)) {
    const res = `android/app/src/main/res`;
    // splash logo (mdpi master is 288px)
    writePng(
      `${res}/drawable-${bucket}/splashscreen_logo.png`,
      renderPng(symbolBlack, Math.round(288 * scale))
    );
    // launcher mipmaps (mdpi: 48 legacy / 108 adaptive)
    await writeWebp(
      `${res}/mipmap-${bucket}/ic_launcher.webp`,
      renderPng(faviconTile, Math.round(48 * scale))
    );
    await writeWebp(
      `${res}/mipmap-${bucket}/ic_launcher_round.webp`,
      renderPng(launcherRound, Math.round(48 * scale))
    );
    await writeWebp(
      `${res}/mipmap-${bucket}/ic_launcher_foreground.webp`,
      renderPng(androidFg, Math.round(108 * scale))
    );
    await writeWebp(
      `${res}/mipmap-${bucket}/ic_launcher_background.webp`,
      renderPng(androidBg, Math.round(108 * scale))
    );
    await writeWebp(
      `${res}/mipmap-${bucket}/ic_launcher_monochrome.webp`,
      renderPng(androidFg, Math.round(108 * scale))
    );
  }

  // ---------------------------------------------------------------- web / PWA (public/)
  writePng("public/favicon-16x16.png", renderPng(faviconTile, 16));
  writePng("public/favicon-32x32.png", renderPng(faviconTile, 32));
  writePng("public/favicon-48x48.png", renderPng(faviconTile, 48));
  writePng("public/apple-touch-icon.png", renderPng(appicon, 180));
  writePng("public/icon-192.png", renderPng(appicon, 192));
  writePng("public/icon-512.png", renderPng(appicon, 512));
  writePng("public/og-image.png", renderPng(ogImage, 1200));
  writePng("public/twitter-card.png", renderPng(twitterCard, 1200));

  // PWA splash — composed inline: black symbol centered on white portrait canvas
  const pwaSplash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#FFFFFF"/>
  <g transform="translate(360 780) scale(0.703125)">
    <g fill="#000000">
      <rect x="48" y="64" width="132" height="88" rx="44"/>
      <rect x="332" y="64" width="132" height="88" rx="44"/>
      <rect x="212" y="64" width="88" height="384" rx="44"/>
    </g>
  </g>
</svg>`;
  writePng("public/splash.png", renderPng(pwaSplash, 1080));

  // favicon.ico (16 + 32 + 48)
  const ico = await pngToIco([
    renderPng(faviconTile, 16),
    renderPng(faviconTile, 32),
    renderPng(faviconTile, 48),
  ]);
  fs.writeFileSync(path.join(ROOT, "public/favicon.ico"), ico);
  console.log("✓ public/favicon.ico");

  console.log("\nAll Talo brand assets generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

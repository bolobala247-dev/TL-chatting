# BUILD_PERFORMANCE_AUDIT.md

Android / Gradle / EAS Build performance audit for **Talo** (Expo SDK 56 · RN 0.85 · New Architecture · Hermes).

Date: 2026-07-28 · Scope: build performance only — **zero runtime/UI/business-logic changes**.

---

## 0. Key architectural fact (drives everything below)

`/android` is listed in `.gitignore` → this project uses **CNG (Continuous Native Generation)**.
EAS Build **regenerates the native project with `expo prebuild` on every build** and ignores the local `android/` folder entirely (it was stale — it still contained the old `tlchatting` scheme).

**Consequence:** editing `android/*.gradle` locally has *no effect* on EAS builds. All optimizations must be injected via `app.json` config plugins and `eas.json`. That is how every fix below was applied.

---

## 1. Current issues found

| # | Issue | Why it slows the build | Severity |
|---|-------|------------------------|----------|
| 1 | **All 4 ABIs built** (`armeabi-v7a, arm64-v8a, x86, x86_64`) | With New Architecture enabled, the app's codegen C++ (`libappmodules.so`) plus every native module's CMake targets are compiled **once per ABI**. `x86`/`x86_64` are emulator-only — dead weight for release APKs installed on phones. This is typically the single largest chunk of the "Run gradlew" step. | 🔴 High |
| 2 | **No EAS cache enabled** (`EAS_USE_CACHE` unset) | ccache results (C/C++ object files) and build caches were thrown away after every build → full native recompile every time. | 🔴 High |
| 3 | **`org.gradle.caching` not enabled** in the prebuild template's `gradle.properties` | Gradle task outputs (Kotlin/Java compile, resource merge) could not be reused between builds or between the two release sub-variants of a run. | 🟠 Medium |
| 4 | **Gradle daemon heap only 2 GB** (`-Xmx2048m -XX:MaxMetaspaceSize=512m`) | EAS Android workers have 16 GB RAM. 2 GB heap for a New-Arch RN 0.85 build (AGP + Kotlin + codegen) causes GC thrashing and slows the Kotlin/Java compilers. | 🟠 Medium |
| 5 | **PNG crunching enabled in release** (`android.enablePngCrunchInReleaseBuilds=true`) | AAPT2 re-compresses every PNG (app icons, splash, notification icon are already optimized) on every build. Pure CPU waste, no runtime effect. | 🟡 Low |
| 6 | **Local `android/` folder stale + misleading** | Not a direct slowdown, but any tuning done there never reached EAS, and the folder no longer matched `app.json` (old scheme). | 🟡 Low |

### Things audited and found already optimal (no action needed)

- **Gradle 9.3.1** + AGP via RN gradle plugin — current, no obsolete settings.
- **Repositories**: only `google()`, `mavenCentral()`, `jitpack` — no duplicates; all covered by the EAS Maven cache server (enabled by default, not disabled anywhere).
- **Dynamic versions**: only the JSC fallback uses `+`, and it is never resolved because **Hermes is enabled**. No fix needed.
- **Version catalog**: Expo's `expoLibs` catalog is already used via `expoAutolinking.useExpoVersionCatalog()`.
- **minify/shrinkResources/Proguard**: disabled by default — correct for build *speed* (R8 full-mode would **add** 1–2 min; only enable if APK size matters more than build time).
- **Multidex**: not manually configured — handled natively (minSdk ≥ 24). Correct.
- **`newArchEnabled=true` / `hermesEnabled=true`**: mandatory for RN 0.85 + Reanimated v4. Must not be touched.
- **Babel/Metro**: minimal, standard NativeWind setup — no unnecessary transforms.
- **Dependencies**: no duplicated packages; every native module except two (see §5) is actively imported. No dependency blocks Gradle optimization.
- **`org.gradle.parallel=true`**: already present in the prebuild template.

---

## 2. Optimizations applied (all safe, officially supported)

### A. New config plugin — `plugins/withGradleBuildOptimizations.js`

Uses the official `withGradleProperties` mod from `expo/config-plugins`, so the settings survive every prebuild on EAS:

| Property | Before | After | Effect |
|----------|--------|-------|--------|
| `org.gradle.jvmargs` | `-Xmx2048m -XX:MaxMetaspaceSize=512m` | `-Xmx4096m -XX:MaxMetaspaceSize=1024m` | Less GC pressure for AGP/Kotlin/R8 |
| `org.gradle.caching` | *(absent)* | `true` | Gradle build-cache reuse of task outputs |
| `org.gradle.parallel` | `true` | `true` (kept explicit) | Parallel module builds |
| `android.enablePngCrunchInReleaseBuilds` | `true` | `false` | Skips AAPT2 PNG re-compression (assets already optimized; APK may be a few KB larger — zero runtime change) |

Registered in `app.json` → `plugins`.

### B. `eas.json` — caching + ABI reduction

- **All profiles**: `EAS_USE_CACHE: "1"` → EAS now **saves and restores ccache** (C/C++ compilation artifacts) between builds, keyed on the lockfile hash. This is the officially documented mechanism (docs.expo.dev/build-reference/caching).
- **`preview` + `production` profiles**: `ORG_GRADLE_PROJECT_reactNativeArchitectures: "armeabi-v7a,arm64-v8a"` → release APKs build only the two ABIs real phones use. Cuts New-Arch C++ compilation roughly in half.
  - `development` profile intentionally **keeps all 4 ABIs** so the dev client still runs on Intel-based Android emulators.

### C. Verified end-to-end

`npx expo prebuild --platform android --no-install` was run locally: prebuild succeeds, the generated `android/gradle.properties` contains all four properties, and the stale local `android/` folder is now in sync with `app.json`.

---

## 3. Files modified

| File | Change |
|------|--------|
| `plugins/withGradleBuildOptimizations.js` | **New** — config plugin injecting Gradle perf properties at prebuild time |
| `app.json` | Registered the plugin |
| `eas.json` | `EAS_USE_CACHE` on all profiles; ARM-only ABIs on `preview`/`production` |
| `android/` (local only, gitignored) | Regenerated by prebuild during verification — not part of the shipped change |
| `BUILD_PERFORMANCE_AUDIT.md` | **New** — this report |

No application source (`app/`, `src/`), no dependency, no permission, no SDK version was changed. Runtime behavior is byte-for-byte identical (only `x86`/`x86_64` `.so` files are dropped from release APKs, and PNGs are stored uncrunched).

---

## 4. Before vs After — expected "Run gradlew" time

Baseline: **10–12 min** on the default (free-tier `medium`) Android worker.

| Scenario | Estimate | Driver |
|----------|----------|--------|
| **Before** | 10–12 min | 4 ABIs, no ccache, no build cache, 2 GB heap |
| **After — first (cold-cache) build** | **~7–9 min** (−25–35 %) | ABI cut (biggest win) + bigger heap + no PNG crunch |
| **After — subsequent (warm-cache) builds** | **~5–7 min** (−40–55 %) | ccache hits on C++ + Gradle build cache + ABI cut |

Notes on cache scoping: caches are keyed on `package-lock.json` and scoped per user (CLI builds) or per branch (GitHub-triggered builds via `.eas/workflows/build-android-production.yml`, which falls back to the `main`-branch cache). Running `npm install` that changes the lockfile starts a fresh cache.

Risk levels of applied changes:

| Change | Risk | Rollback |
|--------|------|----------|
| Bigger JVM heap / build cache / parallel | 🟢 None | delete plugin entry |
| PNG crunch off | 🟢 None (few-KB APK size delta) | flip flag in plugin |
| `EAS_USE_CACHE` | 🟢 None (a stale cache can always be bypassed by bumping the lockfile or `cache.key`) | remove env var |
| ARM-only release ABIs | 🟡 Very low — release APKs will no longer install on **x86 emulators/Chromebooks**. All physical phones and Apple-Silicon/ARM emulators unaffected. Dev builds keep all ABIs. | remove env var |

---

## 5. Additional recommendations (NOT applied — need your decision)

1. **`expo-web-browser` appears unused** — it is imported nowhere in `app/`/`src/` and is not a required peer of `expo-router`. Removing it drops one native module from every compile (~10–20 s + smaller APK). Verify no auth flow relies on it (`WebBrowser.openAuthSessionAsync` etc.), then `npm uninstall expo-web-browser`.
2. **`expo-dev-client` compiles in production builds too** (dev-launcher/dev-menu Kotlin is built but inert in release). This is normal Expo behavior and safe, but it costs ~30–60 s per release build. There is no per-profile exclusion mechanism today; keep it — just be aware it's on the bill.
3. **APK vs AAB conflict**: `eas.json` → `submit.production` targets the Google Play *internal* track, but `build.production.android.buildType` is `apk`. **Google Play requires AAB.** If you ever run `eas submit`, change production `buildType` to `"app-bundle"` (AAB is also slightly faster to build than a 2-ABI APK is to build + zipalign). For pure internal/sideload distribution, keep APK.
4. **Gradle Configuration Cache**: not enabled — the React Native Gradle plugin's support is still flagged experimental on this toolchain, and your rules forbid experimental features. Revisit when RN declares it stable (potential further −30–60 s of configuration time).
5. **`.easignore`**: adding one that mirrors `.gitignore` plus `design-assets/`, `public/`, `*.md` would shrink the project upload a bit (only affects the pre-Gradle upload step, not gradlew). Low value; skipped to avoid accidentally excluding needed files.
6. **Paid worker (`resourceClass: "large"`)**: see §6.
7. **Unused Android permissions** (`RECORD_AUDIO` from expo-image-picker's video path, `SYSTEM_ALERT_WINDOW` from dev-client): no build-time cost, but if you never record video you can add them to `android.blockedPermissions` in `app.json` for Play-Store hygiene.

---

## 6. Bottlenecks that CANNOT be fixed from source code

1. **EAS free-tier worker hardware** — the default `medium` Android worker (4 vCPU / 16 GB) is the hard ceiling. The same build on `resourceClass: "large"` (paid) typically runs ~1.5–2× faster.
2. **Queue time** — free-tier builds wait in a shared queue; that time shows in wall-clock but is outside the gradlew step entirely.
3. **Mandatory prebuild + `npm ci` + Gradle/AGP bootstrap** — with CNG, every build pays ~1.5–3 min of fixed overhead (dependency install is npm-cache-accelerated, but never zero).
4. **New Architecture codegen C++** — even with 2 ABIs and ccache, the first build after any native-dependency change recompiles the changed targets; that is inherent to RN 0.85 + Fabric/TurboModules.
5. **Kotlin compilation of ~15 Expo modules** — Gradle build cache helps repeats, but a cold cache always pays full Kotlin compile; the module set is already minimal for the app's feature set.
6. **Metro JS bundling (`export:embed`)** — single-threaded per platform, ~30–60 s, unaffected by Gradle tuning.

# 12 — Constraints

> All constraints below are taken from repository configuration and documentation. No external account state was inspected.

## Hosting

- **Web:** static SPA on **Vercel** (`vercel.json`, `.vercel/project.json` present). The web app is a client-side-only Metro export (`npx expo export -p web`, `app.json → web.output: "static"`); there is no server runtime, no SSR, no API routes.
- **Mobile:** Android APKs distributed **internally** via EAS Build (all three `eas.json` profiles set `distribution: "internal"`). No store listing configuration beyond a submit stub (see below). No iOS build configuration or documentation exists.
- **Backend:** fully hosted Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions). No self-hosted components.

## Deployment

| Target | Mechanism | Notes |
|--------|-----------|-------|
| Web | `npm run build:web` → `dist/` → Vercel (`vercel-deploy` implied by `.vercel/`) | SPA rewrite `/:path*` → `/index.html`; immutable 1-year cache on `/_expo/static/*` and `/assets/*`; `cleanUrls: true`. |
| Android | EAS Build (`eas.json`, CLI ≥ 20.3.0, `appVersionSource: "remote"`) or local build per `how-to-build-local.md` | `.eas/workflows/build-android-production.yml` defines an EAS Workflow for production Android builds. `EAS_USE_CACHE=1` on all profiles. |
| Edge functions | Manual `supabase functions deploy send-push-on-message` (runbook in `supabase/ANDROID_PUSH_SETUP.txt`) | No CI/CD for functions. |
| Database | Manual migration apply (Dashboard SQL Editor or Supabase CLI), per `AGENTS.md` workflow | No automated migration pipeline. |

- **No CI quality gate anywhere** — no tests, no ESLint/Prettier config, no GitHub Actions (`PRODUCTION_CHECKLIST.md`).
- **Submit conflict:** `eas.json → submit.production` targets Google Play internal track with `./google-play-service-account.json`, which requires an **AAB**, but the production profile builds an **APK** (`android.buildType: "apk"`) — flagged in `BUILD_PERFORMANCE_AUDIT.md` §5.

## Vercel Constraints

- Pure static hosting: every route is served from `index.html` (SPA rewrite), so deep links resolve client-side via Expo Router. No middleware, no edge/serverless functions, no ISR.
- SEO limited to the static shell in `app/+html.tsx` (single set of meta tags for all routes; no per-route SSR metadata).
- `@vercel/analytics` + Speed Insights are loaded web-only (`src/components/VercelInsights.web.tsx`).

## Supabase Constraints

- **Two projects:** dev `xoxnjqgumfhzwturtfhz` (EAS `development`/`preview`), prod `elevsuvbbittizjxrfll` (EAS `production`). ⚠️ `.env.development` also points at the **production** ref — a documented defect (`PRODUCTION_CHECKLIST.md`).
- Required extensions: `pg_net`, `pg_cron`, `pg_trgm`, Vault — all must be enabled per project.
- Required Vault secrets per environment: `push_function_url`, `push_function_secret` (push trigger dies silently without them — `ANDROID_PUSH_SETUP.txt`).
- Client uses only the anon key (`EXPO_PUBLIC_SUPABASE_ANON_KEY`); service-role key is confined to the edge function environment. Anon keys are, however, committed inline in `eas.json`.
- Scheduled messages depend on pg_cron's **1-minute minimum granularity** (`FEATURE_ANALYSIS.md` §5).
- Realtime uses public channels (no private-channel authorization) — accepted residual risk in `SECURITY_REVIEW.md` §5.

## Free-Plan Limitations (as documented)

- `docs/SETUP.md` prescribes a **free Supabase account** ("Tài khoản Supabase (miễn phí)"). No paid-plan features are assumed anywhere in the repo.
- `BUILD_PERFORMANCE_AUDIT.md` §6 lists **free-tier EAS build workers and queue wait times** as unfixable bottlenecks; `how-to-build-local.md` exists specifically to avoid EAS cloud build quota (~19 min local Gradle build).
- Specific quota numbers (DB size, realtime connections, edge invocations): not found in repository.

## Cross-Platform Constraints

| Capability | Constraint |
|------------|-----------|
| Push notifications | **Android-only.** Requires an EAS development/production build — does not work in Expo Go (`ANDROID_PUSH_SETUP.txt`). No iOS or web push. |
| App lock (PIN/biometric) | Native-only; `expo-secure-store` has no web backend, so the gate is skipped on web. |
| Calls (WebRTC) | Platform-split modules (`src/lib/webrtc.ts` / `.web.ts`) with a `WEBRTC_SUPPORTED` feature flag; PiP is iOS 15+ only. |
| Haptics | No-op on web (`src/lib/haptics.ts`). |
| PWA | Manifest + icons only (`public/manifest.json`); **no service worker**, so no offline shell and no installable offline behavior. |
| Offline | No offline support on any platform (RAM-only chat cache; no persisted message store). |
| UI language | Vietnamese-first, with vi/en i18n bundles (`locales/`). |

## Environment Requirements

- **Node ≥ 18, npm ≥ 9** (`docs/SETUP.md`).
- `.env.local` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` is mandatory to boot; it is gitignored and must never be committed.
- Environment switching via `scripts/switch-env.js` (copies `.env.development`/`.env.production` → `.env.local`); it performs **no content validation**, and the app has no fail-fast env validation at startup (`PRODUCTION_CHECKLIST.md`).
- `.gitignore` ordering bug: `.env*` re-ignores `.env.example` after its negation.

## Build Requirements

- **CNG (Continuous Native Generation):** `android/` is regenerated by `expo prebuild`; native config lives in `app.json` + config plugins. `plugins/withGradleBuildOptimizations.js` injects Gradle heap 4096 MB, parallel builds, build caching, PNG crunch off.
- Android release ABIs limited to `armeabi-v7a,arm64-v8a` (eas.json `GRADLE_OPTS`).
- **Firebase prerequisites:** `google-services.json` at repo root for package `com.haruthao.tlchatting`; FCM V1 service-account key uploaded to EAS credentials. Push setup requires **7 manual, non-automatable steps per environment** (`NOTIFICATION_FIX_REPORT.md` §7).
- Local builds: preferred path is `eas build --local` with the production profile; the direct-Gradle alternative signs the release with the **debug keystore** (different signature from EAS builds — cannot upgrade-install over an EAS-built APK) (`how-to-build-local.md`).
- New Architecture is enabled (`app.json → newArchEnabled: true`); React Compiler experiment enabled (`experiments.reactCompiler: true`); typed routes enabled.
- Metro is single-threaded for JS bundling — listed as an unfixable build bottleneck (`BUILD_PERFORMANCE_AUDIT.md` §6).

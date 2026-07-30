# 01 — Project Overview

> Architecture snapshot generated from repository analysis. All statements are backed by repository evidence; anything not determinable from the repo is marked "Not found in repository".

## Project Purpose

**Talo** (repo name `TL-chatting`, Android package `com.haruthao.tlchatting`) is a real-time chat application built with Expo SDK 56 / React Native 0.85 and Supabase. It targets Android (EAS builds), Web (static Expo export deployed to Vercel), and iOS (configured in `app.json` but push notifications are Android-only). The primary UI language is **Vietnamese**, with English as a second locale (i18next, `locales/en` + `locales/vi`).

Brand identity (per `docs/BRAND_GUIDELINE.md`): monochrome black/white, "The Beam" T symbol, Inter typography, no accent colors.

## Current Development Status

- Feature-complete for a v1 messenger with an extensive feature set (see below), backed by 16 sequential SQL migrations.
- **Explicitly declared "NOT production-ready"** in `PRODUCTION_CHECKLIST.md` (dated 2026-07-29). All checklist items are unchecked. Launch blockers include: public `chat-media` bucket, no crash reporting, unfiltered global realtime channel, dev env pointing at production DB, no tests, no lint/CI.
- Local Android production APK builds verified working (`how-to-build-local.md`, dated 2026-07-30, versionCode 15, ~79 MB APK).
- Web deployment live on Vercel as a static SPA export.
- Zero TODO/FIXME/HACK markers in source; technical debt is instead tracked in documents (`PRODUCTION_CHECKLIST.md`, `docs/SECURITY_REVIEW.md` §5, `docs/reports/*`).

## Main Features (implemented)

Per `README.md`, source tree, and migrations:

- **Messaging**: 1-1 (direct) and group chat; text, image, album (up to 10 images), file/video types in schema; replies; flat threads (`thread_id`); @mentions (stored in `messages.metadata`)
- **Message actions**: edit (with edit window), recall/delete-for-everyone (soft delete with tombstone), undo-send (8-second window), pin messages, save/bookmark messages, emoji reactions, polls (single-choice voting)
- **Scheduled messages**: outbox table delivered server-side by a pg_cron job every minute
- **Search**: global message/image/file/link search via trigram-indexed `search_messages` RPC; profile search
- **Conversations**: unread counts, read receipts (watermark-based, privacy-toggleable), typing indicators (Supabase Presence, privacy-toggleable), conversation bookmarks (pinned rooms), room list previews
- **Calls**: 1-1 audio/video calls via `react-native-webrtc` — Supabase Realtime for signaling only (calls table + per-call broadcast channel), P2P media, iOS PiP support
- **Push notifications**: Android-only, Expo Push API via a DB trigger → Deno edge function pipeline, localized per-recipient (en/vi), deep-link to room on tap
- **Privacy & safety**: block users, report users, last-seen/online visibility levels, avatar/phone visibility, read-receipt and typing-indicator toggles, biometric/PIN app lock (native only)
- **Auth**: email or username + password login (username resolved via RPC), registration, forgot/reset password with deep-link redirect
- **Personalization**: light/dark/system theme, en/vi language switcher (persisted locally + synced to profile), per-room drafts (persisted), recent emojis (persisted)

## Features In Progress

No feature-flagged or partially built code found in the source. Items *documented as unfinished* (see `11-technical-debt.md` for details):

- Tab-bar total-unread badge and app-icon badge count — not implemented (`docs/reports/NOTIFICATION_FIX_REPORT.md` §6)
- iOS and web push notifications — unsupported by design (Android-only token pipeline)
- Video capture/upload UI — schema supports `video` type but the picker is image-only (`docs/reports/FEATURE_ANALYSIS.md` §4)

## Planned Roadmap

No single roadmap document exists. Planned/deferred items collected from documentation:

- **`PRODUCTION_CHECKLIST.md`** "Recommended Before Scale": stronger passwords, thread pagination, per-field Zustand selectors, fail-fast env validation, split the 804-line chat god-screen, remaining FlatList → FlashList migration, EAS env vars instead of committed anon keys
- **`docs/SECURITY_REVIEW.md` §5** (accepted residual risks / follow-ups): private storage buckets + signed URLs, private realtime channels, auth rate-limiting/CAPTCHA, receipt reciprocity
- **`docs/reports/FEATURE_ANALYSIS.md` §4** (deliberately out of scope): video capture UI, delete-for-me, edit history, link previews, scroll-to-pinned-message
- **`docs/DESIGN_SYSTEM.md`** deferred components: Toast, Tooltip, Checkbox, Switch, Dropdown, Progress, Skeleton, voice/reaction bubbles; foldable dual-pane layout out of scope for v1
- **`docs/reports/BUILD_PERFORMANCE_AUDIT.md` §5** unapplied recommendations: drop possibly-unused `expo-web-browser`, resolve APK-vs-AAB Play submission conflict, `.easignore`, Gradle configuration cache, paid EAS worker

## Applications

This repository contains **one application** built from a single codebase targeting three platforms:

| Target | Delivery |
|--------|----------|
| Android | Native app via EAS Build (dev/preview/production profiles) or local Gradle build; push via FCM through Expo Push API |
| Web | Static Metro export (`npx expo export -p web`, `output: "static"`) deployed to Vercel as an SPA; installable PWA shell (manifest, no service worker) |
| iOS | Configured (`supportsTablet: true`, WebRTC permissions) but no push support and no iOS-specific build documentation in the repo |

There is no separate admin app, API server, or second client. The only server-side custom code is one Supabase Edge Function (`send-push-on-message`).

## Packages

**Not a multi-package repository.** There is a single root `package.json` (`name: "talo"`, private). There are no `apps/`, `packages/`, or `shared/` workspaces, no workspace configuration (`workspaces` field, pnpm/yarn/turbo/nx config) — none found in repository.

## Monorepo Architecture

**Not a monorepo.** Single-app Expo project with file-based routing (`app/`) and a layered `src/` module structure (components / hooks / stores / services / lib / theme / types / i18n). Code sharing across platforms is achieved with React Native Web plus platform-split files (`*.web.tsx` / `*.web.ts`), not with shared packages. See `03-repository.md` for the folder breakdown.

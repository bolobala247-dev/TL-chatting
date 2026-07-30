# 10 — Existing Documentation

## Root-Level Documents

| File | Language | Summary |
|------|----------|---------|
| `README.md` (91 lines) | Vietnamese | Project intro: features list, tech-stack table, quick start (needs `.env.local`), npm scripts, directory structure, one-way data-flow note, doc index. License MIT. |
| `AGENTS.md` (210 lines) | English | **Source of truth for AI agents and coding conventions.** Expo SDK 56 warning, stack table, rule-file index, architecture (Screen → Hook → Store/Service → Supabase), anti-patterns table, DB migration workflow, senior engineering principles, coding pattern summary, env var rules, DB schema section (**stale — still describes the original 4 tables**), dev commands, 7 important rules. |
| `CLAUDE.md` (2 lines) | — | `@AGENTS.md` include only. |
| `GEMINI.md` (9 lines) | English | Imports AGENTS.md + Antigravity-specific overrides (read matching `.agent/rules/` file per subfolder; no destructive DB/prod commands; prefer `npx expo start`). |
| `PRODUCTION_CHECKLIST.md` (158 lines, dated 2026-07-29) | English | **The production-readiness / tech-debt ledger.** Verdict: NOT production-ready. 8 sections, all items unchecked; 7 launch blockers (see `11-technical-debt.md`). |
| `how-to-build-local.md` (119 lines) | Vietnamese | Local Android APK build guide (avoids EAS cloud quota). Setup verified 2026-07-30. Preferred: local EAS build with production profile; direct Gradle alternative signs release with the debug keystore (caveat noted). |
| `LICENSE` | — | MIT (stock Expo template copyright header, 650 Industries). |

## docs/

| File | Summary |
|------|---------|
| `BRAND_GUIDELINE.md` (234 lines) | Talo brand book v1.0: monochrome identity, "The Beam" symbol, wordmark, lockups, two-color palette (no accents), icon/favicon rules, Inter typography, do/don't, asset regeneration via `scripts/build-brand-assets.js`. |
| `DESIGN_SYSTEM.md` (270 lines) | Product design system v1.0: semantic color tokens (ink as sole accent), Inter type scale, 8pt spacing, flat elevation, radius/motion tokens, icon rules, empty/loading/error state specs, responsive breakpoints (foldable dual-pane out of scope), dark-mode rules, `src/components/ui/` component contract, deferred component list. |
| `DATABASE_CHANGES.md` (159 lines) | Design rationale for migration 00008 (message features): columns, indexes, integrity trigger, RPC + pg_cron design, RLS matrix, realtime decisions, backward-compat checklist (all checked). |
| `SECURITY_REVIEW.md` (170 lines, 2026-07-28) | Pre-implementation threat model for privacy controls (migration 00010): findings F-1…F-10, per-feature enforcement design (all server-side), consistency matrix, **§5 accepted residual risks** (public buckets, public realtime channels, username oracle, no receipt reciprocity, app lock ≠ encryption). |
| `SETUP.md` (189 lines, Vietnamese) | Setup guide: Supabase project creation, env vars, run migration 00001, auth config, create buckets + policies, run app, troubleshooting. **Stale — covers only the initial 4-table schema.** |

## docs/reports/ (one-off audits)

| File | Summary |
|------|---------|
| `BUILD_PERFORMANCE_AUDIT.md` (128 lines, 2026-07-28) | Gradle/EAS build-speed audit; 6 issues; applied fixes (config plugin + eas.json); §5 unapplied recommendations; §6 unfixable bottlenecks (free-tier worker, Metro single-threaded). |
| `FEATURE_ANALYSIS.md` (105 lines) | Product/model analysis for pin/save/media/edit/recall/undo/scheduled features; §4 out-of-scope list; pg_cron granularity note. |
| `NOTIFICATION_AUDIT.md` (263 lines, 2026-07-28) | End-to-end push audit; 15 problems P1–P15 ranked; messenger UX gap matrix; perf findings; 3-phase fix plan; test checklists. |
| `NOTIFICATION_FIX_REPORT.md` (80 lines, 2026-07-28) | Implementation report: all P1–P15 fixed; §6 remaining risks (no total-unread/app-icon badge, no iOS/web push, cosmetic re-push on tap); §7 manual setup steps per environment. |
| `UI_AUDIT.md` (218 lines) | Historical pre-redesign UI audit: 34 findings (4 critical). Superseded by the executed migration. |
| `UI_MIGRATION_PLAN.md` (139 lines) | 6-phase UI migration roadmap with per-phase gates; document frozen at "Awaiting approval" but the current tree shows it was executed. |
| `UX_FLOW.md` (119 lines) | UX flows for messaging features (action sheet, pinned banner, saved messages, shared media, edit/recall/undo/scheduled), state/theming matrix, Vietnamese copy specs. |

## AI Instructions / Coding Conventions

- `AGENTS.md` is the cross-tool rulebook; `CLAUDE.md` and `GEMINI.md` import it.
- Mirrored modular rules (8 files each, identical topics) in `.cursor/rules/` (`.mdc`), `.agent/rules/`, and `.qoder/rules/`: `00-core-project`, `01-architecture`, `02-screens-routing`, `03-components-ui`, `04-hooks-realtime`, `05-stores-zustand`, `06-services-supabase`, `07-database-migrations`.
- Key conventions encoded there: NativeWind over StyleSheet, expo-image over RN Image, FlashList for long lists, no `supabase.from()` outside services, generated `database.ts` never hand-edited, Vietnamese UI text, optimistic sends, channel cleanup, no `Alert.alert`, individual-field Zustand selectors.

## Developer Guides

- `docs/SETUP.md` (initial setup, stale), `how-to-build-local.md` (local Android builds), `supabase/ANDROID_PUSH_SETUP.txt` (push deployment runbook: Vault secrets, edge function deploy, Firebase/EAS credentials, verification SQL, two-device test matrix; notes push doesn't work in Expo Go).

## Documentation Gaps

- `AGENTS.md` DB schema section and `docs/SETUP.md` describe the original 4-table schema; the actual schema has 15 tables across 16 migrations.
- No API reference, no contribution guide, no changelog, no iOS build documentation. Not found in repository.

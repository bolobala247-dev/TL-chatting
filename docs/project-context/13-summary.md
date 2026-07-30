# 13 — Executive Summary

> Snapshot of the repository as-is (branch state dated ~2026-07-30). Observations only — no solutions proposed. Details and evidence live in docs 01–12.

**Talo** is a single-app, Vietnamese-first real-time chat application: Expo SDK 56 / React Native 0.85 / React 19 / TypeScript strict, Expo Router, Zustand v5, NativeWind v4, with a fully hosted Supabase backend (15 tables, 16 migrations, 1 edge function). It ships to Android (EAS, internal distribution) and web (static SPA on Vercel). Per its own `PRODUCTION_CHECKLIST.md`, it is **not production-ready**.

## Current Architecture Strengths

- **Disciplined layering:** one-way flow Screen → Hook → Store/Service → Supabase is followed almost everywhere; services are the single Supabase access layer; deviations are known and documented.
- **Server-side security posture:** RLS enabled on every table, recursion broken via SECURITY DEFINER helpers, privacy rules enforced in SQL (not client-side), writes to sensitive tables funneled through RPCs (e.g., `submit_report`, `mark_room_read`).
- **Correct realtime hygiene:** every channel is cleaned up in effect teardowns; reconnection has a deliberate 3 s resubscribe strategy; watermark-based read receipts avoid per-message receipt rows.
- **Deliberate performance work:** FlashList v2 message list with memoized rows, lazy/Suspense code-splitting (10 sheets, CallHost, EmojiPicker), expo-image memory-disk caching, font subsetting, Gradle build optimizations via a custom config plugin, 00016 index tuning.
- **Optimistic UX done properly:** temp-ID sends with race-safe replacement, 8 s undo window, block-aware sends.
- **Unusually strong documentation culture:** migration rationale docs, a threat model, audits with fix reports, an honest production checklist, and mirrored AI-agent rule sets — while the source tree carries **zero** TODO/FIXME markers.

## Current Weaknesses

- **Zero automated quality gates:** no tests of any kind, no ESLint/Prettier config, no CI. Three `exhaustive-deps` disables exist with no linter to enforce the rule.
- **No observability:** no crash reporting, no logging abstraction (~48 raw `console.*` calls, ~20 silent catches).
- **No offline story:** chat state is RAM-only with no eviction; a network drop mid-session triggers full refetches; nothing persists across restarts except drafts, emoji history, theme, and session.
- **Concentrated complexity:** `app/chat/[roomId].tsx` is an 804-line god-screen; a single `loading` flag serves initial load, pagination, and refetch; ~17 `as any` casts sit on JSONB columns.
- **Stale core docs:** `AGENTS.md` and `docs/SETUP.md` still describe the original 4-table schema versus the real 15.
- **Feature gaps behind the schema:** `video` and `file` message types exist in the DB with no capture/upload UI.

## Major Risks

1. **Public `chat-media` bucket** with semi-guessable paths (`{roomId}/{timestamp}.jpg`) — anyone with a URL can read media (launch blocker #1).
2. **Unfiltered `global:messages` realtime channel** — every client receives every message INSERT in the system; RLS limits payload reads but the fan-out is unconditional.
3. **`.env.development` points at the production database** — local development can mutate prod data.
4. **No crash reporting** — production failures on user devices are invisible.
5. **Public realtime channels + username→email RPC** — enumeration/eavesdropping surfaces accepted only operationally (`SECURITY_REVIEW.md` §5).
6. **App lock is a UI gate, not encryption**, with a single-round SHA-256 PIN hash.
7. **Anon keys committed inline in `eas.json`**; secrets discipline is otherwise good but not consistent.

## Performance Concerns

- Reconnect triggers a **full room + message refetch** rather than a delta fetch.
- **Unbounded in-memory message cache** across all visited rooms (no eviction).
- **N+1-adjacent sender-name lookups** on the global channel (mitigated by a 200-entry LRU, but cold entries still query `profiles` directly from a hook).
- Presence is **polled every 30 s** rather than event-driven.
- `getThreadMessages` is unpaginated; `get_user_rooms` performs per-room lateral scans over message history.
- **No prefetching anywhere** (rooms, images, adjacent pages).
- Room list still uses `FlatList` while the message list uses FlashList.

## Scalability Concerns

- The global channel makes client work **O(total system messages)** — the documented scaling ceiling.
- `get_user_rooms` cost grows with room count × message history per user.
- Push fan-out runs through a single edge function calling Expo Push in chunks; no queue or retry infrastructure.
- Scheduled delivery is bound to pg_cron's 1-minute tick.
- Everything assumes free-tier Supabase/EAS; no load, quota, or capacity planning is present in the repository.

## Maintainability Concerns

- **No test safety net** for a codebase with intricate realtime/optimistic-update logic — refactoring risk is high.
- The chat god-screen concentrates message, media, poll, call, thread, and sheet logic in one file.
- Duplicated realtime reconnect scaffolding (`useRealtime.ts` and `useCalls.ts` implement the same pattern twice).
- Push setup requires 7 manual, undocumented-in-code steps per environment; drift between environments is easy.
- Documentation drift is already occurring (stale schema sections, a migration plan frozen at "Awaiting approval" though executed); debt is tracked in markdown ledgers, which stay accurate only with discipline.
- Leftovers signal mid-flight restructuring: empty root `components/`/`constants/` dirs, debug-keystore local release signing, APK-vs-AAB submit conflict, stock Expo LICENSE header.

## Bottom Line

The repository is a well-architected, well-documented single-developer-scale chat app whose design decisions (layering, RLS, optimistic UX, realtime cleanup) are sound and consistently applied. Its gaps are operational rather than architectural: no tests/CI/observability, a known realtime scaling ceiling, a public media bucket, and environment hygiene issues — all of which the project itself has already catalogued in `PRODUCTION_CHECKLIST.md`.

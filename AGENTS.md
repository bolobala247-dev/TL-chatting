# TL-Chatting — Project Rules for AI Agents

## Critical: Expo SDK 56

This project uses **Expo SDK 56** with React Native 0.85. Expo HAS CHANGED significantly.
**Always read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.**
Do NOT rely on outdated Expo knowledge. Many APIs have been renamed, moved, or deprecated.

---

## Project Overview

**TL-Chatting** is a real-time chat application built with:

| Layer | Technology |
|-------|-----------|
| Framework | Expo SDK 56 (React Native 0.85) |
| Language | TypeScript (strict mode) |
| Navigation | Expo Router (file-based routing) |
| State Management | Zustand v5 |
| Styling | NativeWind v4 (TailwindCSS 3.x) |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Image Loading | expo-image |
| Animations | react-native-reanimated v4 |
| List Performance | @shopify/flash-list |

---

## Rule Files Index

Modular rules for IDE-specific context loading. Full details live in these files; this document is the cross-tool source of truth.

| Topic | Cursor | Antigravity |
|-------|--------|-------------|
| Core project | `.cursor/rules/00-core-project.mdc` | `.agent/rules/00-core-project.md` |
| Architecture | `.cursor/rules/01-architecture.mdc` | `.agent/rules/01-architecture.md` |
| Screens & routing | `.cursor/rules/02-screens-routing.mdc` | `.agent/rules/02-screens-routing.md` |
| Components & UI | `.cursor/rules/03-components-ui.mdc` | `.agent/rules/03-components-ui.md` |
| Hooks & realtime | `.cursor/rules/04-hooks-realtime.mdc` | `.agent/rules/04-hooks-realtime.md` |
| Zustand stores | `.cursor/rules/05-stores-zustand.mdc` | `.agent/rules/05-stores-zustand.md` |
| Services & Supabase | `.cursor/rules/06-services-supabase.mdc` | `.agent/rules/06-services-supabase.md` |
| Database migrations | `.cursor/rules/07-database-migrations.mdc` | `.agent/rules/07-database-migrations.md` |

Also read `GEMINI.md` when using Antigravity (imports this file + Antigravity-specific overrides).

---

## Architecture & Data Flow

One-way data flow — never bypass layers:

```
Screen (app/) → Hook (src/hooks/) → Store / Service → Supabase (src/lib/supabase.ts)
                                      ↑
Realtime hooks subscribe here and dispatch store actions
```

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Screens | `app/` | Layout, navigation, compose hooks + components |
| Components | `src/components/` | Presentational UI only — no direct Supabase calls |
| Hooks | `src/hooks/` | Orchestrate stores, services, realtime subscriptions |
| Stores | `src/stores/` | Client state, optimistic updates, loading flags |
| Services | `src/services/` | All Supabase queries and mutations |
| Types | `src/types/` | DB types + domain aliases |

**Known exception:** `authStore.ts` calls `supabase.auth` directly. New auth features should prefer an `authService` for consistency.

---

## Directory Structure

```
TL-chatting/
├── app/                          # Expo Router screens & layouts
│   ├── _layout.tsx               # Root layout + AuthGate
│   ├── (auth)/                   # Auth group (login, register, forgot/reset password)
│   ├── (tabs)/                   # Main tab group (Tin nhắn, Danh bạ, Cài đặt)
│   ├── chat/[roomId].tsx         # Dynamic chat screen
│   └── +not-found.tsx            # 404 screen
├── src/
│   ├── components/               # chat/, rooms/, ui/
│   ├── hooks/                    # useAuth, useMessages, useRealtime...
│   ├── lib/                      # Supabase client & constants
│   ├── services/                 # messageService, roomService, profileService
│   ├── stores/                   # authStore, chatStore, roomStore
│   └── types/                    # database.ts, index.ts
├── supabase/migrations/          # Sequential SQL migrations
├── .cursor/rules/                # Cursor modular rules
├── .agent/rules/                 # Antigravity modular rules
└── .env.local                    # Supabase credentials (NEVER commit)
```

---

## Anti-patterns

| Do NOT | Do instead |
|--------|------------|
| `StyleSheet.create()` | NativeWind `className` |
| React Native `Image` | `Image` from `expo-image` |
| `FlatList` for long lists | `@shopify/flash-list` |
| `supabase.from()` in components/screens | Call via `*Service` |
| Edit `src/types/database.ts` by hand | SQL migration + regenerate types |
| `service_role` key on client | `EXPO_PUBLIC_SUPABASE_ANON_KEY` only |
| HTML elements (`div`, `span`) | RN primitives (`View`, `Text`, `Pressable`) |
| Arrow function component exports | `export default function ScreenName()` |
| `Alert.alert` for user feedback (validation, success, errors) | Inline `Text` under inputs; success screen; `console.error` for unexpected API errors |
| `Alert.alert` for destructive confirms | `ConfirmDialog` component |
| Destructure entire Zustand store | Select individual fields: `useStore((s) => s.field)` |

---

## Database Change Workflow

1. Create `supabase/migrations/0000N_description.sql` (sequential numbering)
2. Include RLS policies on every new table
3. Enable Realtime on tables that need live updates (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`)
4. Apply migration via Supabase Dashboard SQL Editor or Supabase CLI
5. Regenerate TypeScript types:
   ```bash
   npx supabase gen types typescript --project-id <your-project-id> > src/types/database.ts
   ```
6. Update domain aliases in `src/types/index.ts` if new tables were added
7. Add or extend service methods — never query new tables from components

---

## Senior Engineering Principles

1. **Minimize scope** — smallest correct diff; no unrelated refactors
2. **Match existing patterns** — read surrounding code before writing
3. **No over-engineering** — no abstractions for one-off use; no premature optimization
4. **Preserve comments** — keep existing comments and structure when editing
5. **Vietnamese UI** — all user-facing strings in Vietnamese
6. **Optimistic UX** — temp message → replace on success → remove on error for sends
7. **Cleanup subscriptions** — always `supabase.removeChannel(channel)` in `useEffect` return
8. **Never commit secrets** — `.env.local`, debug logs, credentials

---

## Coding Patterns (Summary)

Details and examples in modular rule files above.

- **Imports:** `@/` alias; `import type` for types; order: React/RN → expo → `@/` → relative
- **Components:** Screens in `app/`, reusables in `src/components/`; function declarations for exports
- **Styling:** NativeWind `className`; palette `primary-*`, `surface-*` from `tailwind.config.ts`
- **Services:** Plain objects with async methods; `if (error) throw error`; `data ?? []` for lists
- **Stores:** `create<State>((set, get) => ({...}))`; `use[Domain]Store` naming; loading via try/finally
- **Hooks:** Bridge UI ↔ stores/services; `useCallback` for list handlers; stable empty constants (`EMPTY_MESSAGES`)
- **Types:** `Tables<>`, `InsertTables<>`, `UpdateTables<>` from `src/types/index.ts`
- **Navigation:** Expo Router file-based; `(auth)` / `(tabs)` groups; `AuthGate` in root `_layout.tsx`
- **Realtime:** Channels `room:${roomId}`, `global:messages`, `typing:${roomId}`
- **Icons:** `expo-symbols` `SymbolView` with `{ ios, android, web }` names
- **User feedback:** Do not use `Alert.alert` for validation/success/errors — it is unreliable on web. Show inline errors under fields, dedicated success UI, or `console.error` for debugging

---

## Environment Variables

- Prefix public env vars with `EXPO_PUBLIC_`
- `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- Access via `process.env.EXPO_PUBLIC_*`
- **NEVER** use `service_role` key on client side
- `.env.local` is gitignored — NEVER commit credentials

---

## Database Schema

4 tables with RLS enabled:

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (auto-created via trigger on auth.users) |
| `rooms` | Chat rooms (type: "direct" or "group") |
| `room_participants` | Room membership (role: "admin" or "member") |
| `messages` | Chat messages (type: "text", "image", "file", "system") |

- RPC: `get_user_rooms(p_user_id)` returns `RoomWithLastMessage[]`
- Realtime enabled on `messages` and `room_participants`
- Storage buckets: `avatars` (public), `chat-media` (public)

---

## Dev Commands

```bash
npm install
npx expo start              # Dev server (preferred over npm start)
npx expo start --clear      # Clear Metro cache
npx expo run:ios            # Native iOS build
npx expo run:android        # Native Android build
```

EAS build profiles in `eas.json`: `development`, `preview`, `production`.

---

## Important Rules

1. **Never modify** `src/types/database.ts` manually
2. **Never expose** Supabase service_role key in client code
3. **Always clean up** Supabase channel subscriptions in useEffect return
4. **Always use** optimistic updates for sending messages
5. **SQL migrations** in `supabase/migrations/` with `00001_`, `00002_`, etc.
6. **Use `expo-image`** instead of React Native's built-in `Image`
7. **Use `@shopify/flash-list`** for long scrollable lists

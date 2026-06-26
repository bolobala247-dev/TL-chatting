@./AGENTS.md

## Antigravity-specific

- When working in a subfolder, also read the matching file in `.agent/rules/` (e.g. `src/services/` → `06-services-supabase.md`)
- Do not run destructive DB or production commands unless the user explicitly requests it
- Prefer `npx expo start` over ad-hoc npm scripts for dev server
- Modular rules in `.agent/rules/` supplement this file — do not contradict `AGENTS.md`

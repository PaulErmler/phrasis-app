# 09 — Cleanup migration: explicit 'neutral' stamps

Status: resolved
Type: task
Blocked by: 04

Read `../spec.md` (Schema changes → Migration) and
`convex/_generated/ai/guidelines.md` (batched migrations). Model doc:
`docs/migrations/per-mode-settings-backfill.md`.

## Scope
- `convex/migrations.ts`: add `stampNeutralOnUnmarkedTranslations` via
  `@convex-dev/migrations` — for every `translations` row whose
  `targetLanguage` has `speakerGenderMarking === 'none'`, patch
  `speakerGender: 'neutral'` (whatever it held before). Idempotent,
  batched, resumable. Append to `runAll`.
- `docs/migrations/stamp-neutral-unmarked-translations.md` with
  `Status: **NOT yet run**`, background (decision 9: no undefined-with-
  meaning; explicit tri-state stamps), what it does, how it runs
  (`npx convex run migrations:runAll --prod` as part of deploy).
- Marked-language legacy `undefined` rows are deliberately NOT touched (they
  heal lazily via fill-if-missing / collapse).

## Done when
Migration runs clean on dev (spot-check rows before/after); doc committed;
`runAll` includes it; suites green.

## Answer

Implemented in commit `5e29b3c` on `claude/gender-card-translation-plan-3vnuk5`; suites green (typecheck, convex + app vitest).

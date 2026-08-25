# Pending migration: stamp 'neutral' on unmarked-language translations

Status: **NOT yet run** (as of 2026-08-25). Deployment does **not** require it.

## Background

The speaker-gender feature promoted `translations.speakerGender` to an
explicit tri-state variant slot (`'male' | 'female' | 'neutral'`, see the
field's doc in `convex/schema.ts`): on languages that mark speaker gender the
stamp names which speaker the wording renders, `'neutral'` means the
rendering is valid for both genders, and `undefined` is reserved for legacy
rows written before the feature.

On languages whose config says `speakerGenderMarking: 'none'`
(`lib/languages.ts`) a rendering can never differ by speaker gender, so the
correct stamp there is always `'neutral'`. Historical rows on those
languages, however, hold one of two meaningless values:

- `undefined` — written before the field existed, or by paths that never
  stamped; or
- a gender (`'male'`/`'female'`) — the old metadata-apply loop blanket-stamped
  the text's resolved gender onto **every** translation row, English/German/…
  included.

Every reader is tolerant of both (`pickTranslationVariant` ignores stamps on
unmarked languages entirely), so nothing is broken — this is hygiene: after
the migration, every unmarked-language row is explicitly `'neutral'` and
`undefined` on such rows no longer occurs.

Marked-language legacy rows are **deliberately not touched**: `undefined`
there means "canonical carrier" (the row serves the text's canonical gender)
and heals lazily — fill-if-missing stamps the canonical gender explicitly,
and variant collapse re-stamps `'neutral'` when a new variant proves the
sentence gender-invariant. A blanket pass cannot know which gender a marked
language's wording actually renders, so it must not guess.

## What the migration does

`stampNeutralOnUnmarkedTranslations` in `convex/migrations.ts` (built on
`@convex-dev/migrations`, so batched, resumable, and state-tracked) walks all
`translations` docs and patches `speakerGender: 'neutral'` onto every row
whose `targetLanguage` has marking `'none'` — whatever the row held before.
Rows already `'neutral'` and all marked-language rows return no patch, so
re-runs are cheap and the pass is idempotent.

## How it runs

Migrations run automatically as part of the deploy command:

```
npx convex deploy --cmd "pnpm run build" && npx convex run migrations:runAll --prod
```

`migrations:runAll` (convex/migrations.ts) runs every registered migration in
order; completed ones are skipped. Useful one-offs:

```
npx convex run migrations:stampNeutralOnUnmarkedTranslations '{"dryRun": true}'  # preview
npx convex run --component migrations lib:getStatus --watch                      # progress
```

## After it has completed in production

No compatibility code becomes removable — readers keep tolerating
`undefined` because marked-language legacy rows continue to heal lazily for
as long as they exist. The win is invariant tightening: on unmarked
languages, `speakerGender` is always an explicit `'neutral'`, and any future
audit can treat a gendered stamp on an unmarked language as a bug.

# Pending migration: per-mode playback settings backfill

Status: **NOT yet run** (as of 2026-07-10). Deployment does **not** require it.

## Background

The `transcription-mode` branch split the audio playback settings per review
mode: the unsuffixed `courseSettings` fields (`languageRepetitions`,
`pauseBaseToBase`, `autoPlayAudio`, `highlightWords`, …) remain authoritative
for audio/Shadowing mode (and radio), new `*Full` counterparts
(`languageRepetitionsFull`, `pauseBaseToBaseFull`, `autoPlayAudioFull`,
`highlightWordsFull`, …) hold the Writing/Translate values, and `*Transcribe`
counterparts (reps/pauses/speeds, `pauseTargetToTargetTranscribe`,
`autoPlayAudioTranscribe`, `highlightWordsTranscribe`) hold the
Writing/Transcribe values (plus the `transcribeAfter*` post-submit replay
records).

Writing modes resolve every playback value along the chain

```
Transcribe:  *Transcribe ?? *Full ?? <unsuffixed audio field> ?? DEFAULT_*
Translate:   *Full ?? <unsuffixed audio field> ?? DEFAULT_*
```

so **unmigrated docs behave identically in all modes** and no migration is
needed between deploys. The first edit of a setting in a mode snapshots the
effective value into that mode's field (the settings UI spreads the effective
map), after which the modes diverge for that field.

The `*Transcribe` / `transcribeAfter*` fields are NOT part of this migration:
Transcribe shipped after the split, so no user has legacy state there. The
`?? *Full` inheritance is the intended default, not a compatibility shim.

New-user defaults (Practice Listening ON, "Only new" = 1) are stamped
explicitly at courseSettings insert time in `convex/db/courseSettings.ts`
(`upsertCourseSettings` insert branch), deliberately NOT via the read-side
`DEFAULT_*` constants, which would have flipped existing users.

## What the migration does

`perModeSettingsBackfill` in `convex/migrations.ts` (built on
`@convex-dev/migrations`, so batched, resumable, and state-tracked) walks all
`courseSettings` docs and stamps, per doc (only where currently `undefined`):

1. Every `*Full` field from the doc's current effective audio value.
2. `playTargetBeforeBase: false`, `playTargetAfterBase: true`,
   `targetBeforeOnlyNewReps: 0`, freezing existing users on today's
   read-side defaults.

It is idempotent and safely re-runnable (per-field `undefined` guards; user
writes are never overwritten).

## How it runs

Migrations run automatically as part of the deploy command:

```
npx convex deploy --cmd "pnpm run build" && npx convex run migrations:runAll --prod
```

`migrations:runAll` (convex/migrations.ts) runs every registered migration in
order; completed ones are skipped, and a failed one stops the chain and
resumes from its cursor on the next invocation. Useful one-offs:

```
npx convex run migrations:perModeSettingsBackfill '{"dryRun": true}'   # preview
npx convex run --component migrations lib:getStatus --watch           # progress
```

Already run to completion on the dev deployment (2026-07-10, 241 docs).

## Cleanup enabled after it has completed IN PRODUCTION

Do NOT remove the fallbacks in the same deploy that first ships this feature:
`runAll` executes *after* `convex deploy` finishes, so there is a window where
the new code serves not-yet-stamped docs (and an indefinite one if the
migration errors). One deploy after the migration has reported `success` in
prod (`lib:getStatus --prod`), the unmigrated-doc compatibility code can go:

Once every doc is stamped, the unmigrated-doc compatibility code can be
removed:

- The `?? <audio field>` fallback branch in
  `lib/audio/mergeAudio.ts` → `resolveAudioSettings` (`pick()` helper).
- The `autoPlayAudioFull ?? autoPlayAudio` fallback in
  `components/app/learning/useLearningAudio.ts`.
- The `highlightWordsFull ?? highlightWords` and
  `languagePlaybackSpeedsFull ?? languagePlaybackSpeeds` fallbacks in
  `components/app/LearningMode.tsx`.
- The `isFull ? (*Full ?? legacy) : legacy` effective-read helpers in
  `components/app/LearningModeSettings.tsx` (writing mode then reads the
  `*Full` fields directly).
- Optionally: replace the insert-time stamping of
  `playTargetBeforeBase` / `playTargetAfterBase` / `targetBeforeOnlyNewReps`
  in `convex/db/courseSettings.ts` with flipped `DEFAULT_*` constants
  (`DEFAULT_PLAY_TARGET_BEFORE_BASE = true`, only-new default 1), safe only
  because step 2 froze existing users. Never re-run the migration after such
  a flip (it stamps the OLD defaults).

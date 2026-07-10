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
Transcribe shipped after the split, so no user has legacy state there — the
`?? *Full` inheritance is the intended default, not a compatibility shim.

New-user defaults (Practice Listening ON, "Only new" = 1) are stamped
explicitly at courseSettings insert time in `convex/db/courseSettings.ts`
(`upsertCourseSettings` insert branch) — deliberately NOT via the read-side
`DEFAULT_*` constants, which would have flipped existing users.

## What the migration does

`convex/migrations/perModeSettingsBackfill.ts` walks all `courseSettings` docs
in self-scheduling batches of 100 and stamps, per doc (only where currently
`undefined`):

1. Every `*Full` field from the doc's current effective audio value.
2. `playTargetBeforeBase: false`, `playTargetAfterBase: true`,
   `targetBeforeOnlyNewReps: 0` — freezing existing users on today's
   read-side defaults.

It is idempotent and safely re-runnable (per-field `undefined` guards; user
writes are never overwritten).

## How to run it

```
npx convex run migrations/perModeSettingsBackfill:run
```

(add `--prod` for the production deployment). It self-continues via the
scheduler; the return value of each batch reports `processed` / `patched` /
`isDone`.

## Cleanup enabled after it has completed

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
  (`DEFAULT_PLAY_TARGET_BEFORE_BASE = true`, only-new default 1) — safe only
  because step 2 froze existing users. Never re-run the migration after such
  a flip (it stamps the OLD defaults).

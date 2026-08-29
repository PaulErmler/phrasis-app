# Review modes

The `/learn` page supports two review modes that users can switch between via the settings panel. The active mode is persisted per course in `courseSettings.reviewMode`:

- **Shadowing** (`reviewMode: 'audio'`, the default). Listen, translate in your head, say it aloud.
- **Writing** (`reviewMode: 'full'`). Type the answer and get diff feedback. Writing further splits into two input styles via `courseSettings.writingInputMode` (see below).

There is also a *free play* mode at the scheduling level (`courseSettings.schedulingMode: 'radio'`), an endless round-robin through the whole deck that never touches the FSRS schedule. It is a single scheduling mode with two **faces**, chosen by the review mode rather than stored:

- **Radio** (`reviewMode: 'audio'`). Hands-free background playback that loops cards on its own, forcing autoplay and auto-advance regardless of the user's settings.
- **Free Study** (`reviewMode: 'full'`). The typing counterpart: same endless shuffle, but user-paced like any other Writing session.

Flipping the Shadowing/Writing switcher mid-session therefore switches faces live. Queue, playback behaviour, card UI and the header pill all follow. The two faces keep **separate per-card rotations** (`cards.radio*` vs `cards.freeStudy*`, one index pair each), so practising a card by listening never counts as having typed it, and vice versa. The active face is derived by `freePlayFace()` in `convex/types.ts`; `reviewLogs.kind` stores it so undo restores the right rotation.

## Shadowing (`reviewMode: 'audio'`, default)

The original review experience. The user listens to audio playback of base and target languages, optionally with target text hidden/blurred, says the sentence aloud, and rates the card based on recall.

### Mode-specific settings

| Setting | Description |
|---------|-------------|
| **Initial reviews** | Number of pre-review repetitions before FSRS scheduling kicks in. During pre-review, the user sees simplified ratings ("Still learning" / "Understood"). |
| **Auto-advance** | Automatically advance to the next card after audio playback finishes. |
| **Hide target languages** | Blur target language text by default. |
| **Auto-reveal** | Unblur target text when its audio segment starts playing. |

### Scheduling

Cards go through two phases:
1. **Pre-review.** Shown `initialReviewCount` times with binary ratings.
2. **Review.** Scheduled via FSRS with ratings: Again, Hard, Good, Easy.

## Writing (`reviewMode: 'full'`)

A text-input-based review where the user types text for each target language and sees a character-level diff of their answer against the expected text.

### Input styles: Translate vs Transcribe (`writingInputMode`)

Writing has two input styles, stored in `courseSettings.writingInputMode`
(`'translate' | 'transcribe'`, optional; see `convex/schema.ts`, ignored in
Shadowing):

- **Translate** (default). Base audio plays and the base text is shown; the
  user types the translation for each target language.
- **Transcribe.** Target audio plays alone; the user types exactly what they
  hear (listening-comprehension practice). The diff/accuracy pipeline is the
  same as Translate.

  AI feedback (`courseSettings.aiWritingFeedback`) runs in both styles, but
  Transcribe grades in transcription mode (`gradeWritingAnswer`'s
  `mode: 'transcribe'`): only the card's exact sentence is correct, stored
  accepted alternatives grant no credit (client and server gates both skip
  them), the grader uses a transcription prompt/schema with no `alsoCorrect`
  verdict and no `corrected` sentence, and nothing is ever stored as an
  alternative. The chat "Discuss" action carries a matching `transcribe` flag
  so it words the request as a transcription; separately, and on *every* card
  turn in a transcribe course (free-text follow-ups included), `sendMessage`
  re-reads `writingInputMode` and withholds the `markAlsoCorrect` tool
  altogether. Prompt wording alone would not hold there, because the agent's
  standing prompt invites the tool whenever it is available.

### Per-mode playback settings

Playback settings are split per mode: the unsuffixed `courseSettings` fields
(`languageRepetitions`, `pauseBaseToBase`, `autoPlayAudio`, `highlightWords`,
…) remain authoritative for Shadowing (including free play's Radio face; its
Free Study face resolves the Writing chain like any other typing session), the `*Full` counterparts
hold the Writing/Translate values, and the `*Transcribe` counterparts hold the
Writing/Transcribe values. Writing resolves every playback value along the
chain

```
Transcribe:  *Transcribe ?? *Full ?? <unsuffixed audio field> ?? DEFAULT_*
Translate:   *Full ?? <unsuffixed audio field> ?? DEFAULT_*
```

so documents without the suffixed fields behave identically in all modes. The
first edit of a setting in a mode snapshots the effective value into that
mode's field, after which the modes diverge for that field. Full details (and
the pending backfill migration) in `docs/migrations/per-mode-settings-backfill.md`.

### Flow (as seen in Translate; Transcribe differs only in the prompt)

1. Base language translations are shown (read-only) with audio buttons.
2. For each target language, a text input is displayed with an audio button and a submit button. When there is only one target language, the language label is hidden. When there are multiple, the full localized language name is shown.
3. The user types their answer and submits (per-language submit button, or Enter key).
   - Enter is guarded by `useImeSafeEnter` (`hooks/use-ime-safe-enter.ts`): for
     languages typed through an IME (ja, zh, ko, vi) Enter *confirms a
     conversion* rather than submitting, so the keystroke is swallowed while a
     composition is in flight. The next Enter submits.
4. On submit, the input is replaced inline with a diff view from `lib/textCompare/`.
   - Languages **with** word boundaries use `alignWords` (Needleman–Wunsch over
     `Intl.Segmenter` word tokens, Damerau–Levenshtein within a token) rendered
     by `WordDiff`. Tags: `equal` / `typo` (partial credit) / `wrong` /
     `missing` / `extra`.
   - Languages **without** word boundaries (zh, zh_traditional, yue,
     yue_traditional, ja, th, all `hasWordBoundaries: false` in
     `lib/languages.ts`) fall back to a
     grapheme-level `charDiff` built on [jsdiff](https://github.com/kpdecker/jsdiff).
   - **Green**: correct. **Amber**: typo. **Red**: wrong or extra.
     **Dashed**: missing.
   - An accuracy percentage is shown below the diff (`scoreWordAlignment`, or
     `1 - distance/length` on the char path). Punctuation counts at
     `PUNCT_WEIGHT` (0.25 of a word) unless "Ignore punctuation" is on, in
     which case it is zero-weighted and rendered muted rather than as an error.
   - **Both** punctuation variants are always computed (`computeAccuracyPair`
     in `lib/textCompare/accuracy.ts`) and recorded, so the stat keeps its
     meaning when the learner flips the setting. The pair runs two independent
     comparisons rather than re-scoring one alignment: `normalize` strips
     punctuation from *inside* words, so `don't` → `dont` changes the alignment
     itself, not just the weights.
5. The audio play button remains visible after submission. The user rates the card difficulty and advances.
   - With **Auto-rate from accuracy** on (the default), the rating is
     preselected from the score instead of always defaulting to "Good". It is
     only ever *preselected*. Nothing auto-submits, and a tap or number key
     overrides it. Bands are lower-inclusive and configurable: by default
     below 50% → Again, 50-79% → Hard, 80%+ → Good. "Easy" is never
     auto-selected.
   - With multiple target languages the rating uses the **minimum** accuracy
     across the languages submitted so far, so a perfect answer in one language
     can't mask a failed one in another. The *recorded stat* still uses the
     average, and only once every language is submitted.

### Mode-specific settings

| Setting | Description |
|---------|-------------|
| **Ignore punctuation** | Drop punctuation from the accuracy score. Lives at the end of the Review Settings section, above Auto-rate. |
| **Auto-rate from accuracy** | Preselect the rating from the score (default on). Its threshold slider is an indented sub-setting, `AutoRateBandSlider`, built on `@radix-ui/react-slider` because the shadcn wrapper hardcodes its Track/Thumb classNames and Radix draws only one Range. Writes on `onValueCommit`, never `onValueChange`, so a drag is one mutation rather than one per pixel. |
| **Automatically play Target Audio** | Main toggle controlling whether target language audio plays at all. When off, maps to `never`. Subtitle: "When to play target language audio". |
| | Two mutually exclusive sub-options (shown when enabled): |
| | - *After submitting text* (`afterSubmit`, default): target audio plays once automatically after the user submits their text for that language. Not included in the merged audio timeline. |
| | - *After base audio* (`always`): target languages are included in the merged audio timeline, played via the main play button. The playback sequence preview updates to show target languages. |

### Scheduling

Cards skip the pre-review phase entirely. All cards are rated using FSRS ratings (Again, Hard, Good, Easy) regardless of how many times they've been seen. The `reviewCard` mutation accepts a `forceReviewPhase` flag to support this.

## Split scheduling (`separateModeTracking`)

By default both modes share one per-card schedule (`dueDate` / `fsrsState` /
`schedulingPhase`), so reviewing a card in one mode postpones it in the other.
The **Separate progress per mode** toggle (`courseSettings.separateModeTracking`,
default off; rendered inside the mode-description card in the settings sheet,
right after the Shadowing/Writing blurbs) gives Writing its own independent
per-card FSRS track:

- **Data model.** Five optional `writing*` fields on `cards`
  (`writingDueDate`, `writingFsrsState`, `writingIsGraduated`,
  `writingLastReviewedAt`, `writingGoodReviewCount`; see
  `cardWritingSchedulingFields` in `convex/types.ts`). The writing track has no
  pre-review phase. It is always FSRS, matching Writing's `forceReviewPhase`
  behavior. The pre-existing fields remain the *shared* track, which Shadowing
  keeps using (and which both modes use while the split is off).
- **Routing.** `schedulingTrackFromSettings` (convex/types.ts) resolves
  `'writing'` iff the split is on AND the mode is `'full'`. `reviewCard`,
  the shared due-queue selector (`fetchTrackDueCards` in
  convex/lib/dueQueue.ts, one implementation parameterized by track, used by
  serving, probes, and the content warmer), the due-count aggregates
  (`cardsByWritingStateAndDueDate` + origin variant) and the undo stack
  (`reviewLogs.track` / `prevWriting`) are all track-aware. In free play the
  track still resolves to `'writing'` (it scopes undo), but
  `getCardForReview` only surfaces writing-track state for due-queue serving
  (`face === null`). Rotation cards keep their real shared fields.
- **Enable.** `updateCourseSettings` enqueues
  `convex/migrations/seedWritingTrack.ts`, a batched, idempotent copy of each
  card's shared schedule into the writing fields (nothing becomes newly due,
  the copy happens at enable time, so both tracks start from the current
  state). Hidden and mastered cards are seeded too: they can be unhidden or
  demastered later, and the track has to exist by then.

  The sweep carries **no state between batches**. Each batch relocates its own
  remaining work through the `by_deck_writingDue` index, where an unset
  `writingDueDate` sorts before every number, so there is no cursor to lose,
  any kick resumes exactly where the last one stopped, and overlapping sweeps
  simply find nothing to do. A batch re-enqueues itself whenever it seeded
  anything; a pass that finds no unseeded card in any deck is what flips
  `courseSettings.writingSeedDone`.

  Batches run on the `seedPool` workpool rather than the scheduler, for the
  **guaranteed onComplete**: it runs in its own transaction, so it still fires
  when a batch throws (the pool does not retry mutations; Convex already
  retries them on OCC). `onSeedBatchComplete` re-enqueues on failure, counting
  attempts in `writingSeedAttempts`, and after five consecutive failures gives
  up and reports via `trackException` instead of looping silently. Settings
  saves and `reviewCard`'s lazy seed also kick the sweep (debounced via
  `writingSeedStartedAt`), but those are conveniences. The supervisor is the
  recovery path.

  While `writingSeedDone` is unset, `getCardForReviewEmptyReason` reports
  `preparing_writing` instead of a false "all caught up", and
  `getFilteredCardCounts` flags its counts `preparingWriting` so the home pills
  don't render a partial prefix as a settled zero. Both are gated on
  `face === null` / the writing track actually being served. Free play
  resolves to track `'writing'` too but never reads the writing queue.

  `reviewCard` lazy-seeds any card the sweep hasn't reached; the writing due
  queries exclude unseeded cards via a `.gte('writingDueDate', 0)` bound. New
  cards created while the split is on are seeded at insert; there is
  deliberately NO global deploy-time backfill. Unseeded cards cost nothing and
  users who never enable the split never get writing fields.
- **Disable.** Freeze-and-keep: the boolean flips and both modes route back
  to the shared track. The writing fields stay dormant on the cards, and a
  re-enable resumes them (the seeder skips already-seeded cards).

## Common settings (both modes)

| Setting | Description |
|---------|-------------|
| Cards per batch | Number of cards added at once. |
| Auto-add cards | Automatically add new cards when none are due. |
| Auto-play audio | Play audio automatically when a card appears. |
| Playback sequence | Base/target language order, repetitions, and pauses. |
| Show progress bar | Whether to show the audio progress/seek bar. |

## Architecture

### New components

| Component | Path | Purpose |
|-----------|------|---------|
| `ReviewModeSwitcher` | `components/app/learning/ReviewModeSwitcher.tsx` | Split button at the top of settings to toggle between Shadowing and Writing. |
| `FullReviewCardContent` | `components/app/learning/FullReviewCardContent.tsx` | Card view for Writing mode with text inputs and diff display. |
| `DiffDisplay` | `components/app/learning/DiffDisplay.tsx` | Picks the word- or character-level diff based on `hasWordBoundaries`, and exports `computeAccuracy`. |
| `WordDiff` | `components/app/learning/WordDiff.tsx` | Word-aligned diff chips for space-separated scripts. |

### Data model changes

Fields added to the `courseSettings` table:

- `reviewMode` (`'audio' | 'full'`, optional, defaults to `'audio'`)
- `writingInputMode` (`'translate' | 'transcribe'`, optional, defaults to `'translate'`): Writing input style; ignored in Shadowing
- `fullReviewTargetAudioMode` (`'always' | 'afterSubmit' | 'never'`, optional, defaults to `'afterSubmit'`)
- `ignorePunctuation` (`boolean`, optional, defaults to `false`): exclude punctuation from the accuracy score
- `autoRateFromAccuracy` (`boolean`, optional, defaults to **`true`**): preselect the rating from the accuracy score
- `autoRateThresholds` (`{ hard, good, easy? }`, optional, defaults to `{ hard: 50, good: 80 }`): percent breakpoints, 0-100 integers, validated ascending on write

Accuracy stats carry both punctuation variants. `courseStats` and `dailyStats`
each gained `…StrictSum` / `…LenientSum` / `…DualCount` alongside the original
`accuracySum` / `accuracyCount`. The two sums share one count and are written
and reversed as a trio, since a half-written pair would skew the average
permanently. All fields are optional and no backfill exists (or is possible:
recomputing a counterfactual score needs the typed text, which `reviewLogs`
never stored and trims after `UNDO_DEPTH` entries anyway), so the split series
simply starts at deploy. `reviewDepthAccuracy` was deliberately left on the
single series. Its consumer is an `internalQuery` with no frontend reader.

### Backend changes

- `updateCourseSettings` mutation: accepts `reviewMode` and `fullReviewTargetAudioMode`.
- `reviewCard` mutation: accepts optional `forceReviewPhase` boolean. When `true`, overrides the card's scheduling phase to `'review'` so FSRS ratings are accepted for pre-review cards.
- `reviewCard` also accepts `accuracyStrict` / `accuracyLenient` beside `accuracy`. Because Convex validators reject unknown args, **the backend must be deployed before a client that sends them**.

### Audio behavior

In `useLearningAudio`, when in Writing mode:
- Target languages are excluded from the merged audio unless `fullReviewTargetAudioMode === 'always'`.
- Auto-advance is disabled (it is a Shadowing-only feature).
- Individual language audio playback after submit is handled inside `FullReviewCardContent` using the existing `AudioButton` mechanism.

In the settings panel, the playback sequence preview (timeline) conditionally hides target language cards and their connectors when they are not part of the main audio sequence (i.e., when the target audio setting is `afterSubmit` or `never`).

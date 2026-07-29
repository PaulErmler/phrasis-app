# Review Modes

The `/learn` page supports two review modes that users can switch between via the settings panel. The active mode is persisted per course in `courseSettings.reviewMode`:

- **Shadowing** (`reviewMode: 'audio'`, the default) — listen, translate in your head, say it aloud.
- **Writing** (`reviewMode: 'full'`) — type the answer and get diff feedback. Writing further splits into two input styles via `courseSettings.writingInputMode` (see below).

Shadowing also has a third *study* mode at the scheduling level: **Radio** (`courseSettings.schedulingMode: 'radio'`) — audio-only round-robin background playback that loops cards hands-free without affecting their FSRS schedule. Radio is only available in Shadowing.

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
1. **Pre-review** — shown `initialReviewCount` times with binary ratings.
2. **Review** — scheduled via FSRS with ratings: Again, Hard, Good, Easy.

## Writing (`reviewMode: 'full'`)

A text-input-based review where the user types text for each target language and sees a character-level diff of their answer against the expected text.

### Input styles: Translate vs Transcribe (`writingInputMode`)

Writing has two input styles, stored in `courseSettings.writingInputMode`
(`'translate' | 'transcribe'`, optional — see `convex/schema.ts`; ignored in
Shadowing):

- **Translate** (default) — base audio plays and the base text is shown; the
  user types the translation for each target language.
- **Transcribe** — target audio plays alone; the user types exactly what they
  hear (listening-comprehension practice). The diff/accuracy pipeline is the
  same as Translate.

### Per-mode playback settings

Playback settings are split per mode: the unsuffixed `courseSettings` fields
(`languageRepetitions`, `pauseBaseToBase`, `autoPlayAudio`, `highlightWords`,
…) remain authoritative for Shadowing (and Radio), the `*Full` counterparts
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
     yue_traditional, ja, th — `hasWordBoundaries: false` in
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
     only ever *preselected* — nothing auto-submits, and a tap or number key
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
| **Auto-rate from accuracy** | Preselect the rating from the score (default on). Its threshold slider is an indented sub-setting — `AutoRateBandSlider`, built on `@radix-ui/react-slider` because the shadcn wrapper hardcodes its Track/Thumb classNames and Radix draws only one Range. Writes on `onValueCommit`, never `onValueChange`, so a drag is one mutation rather than one per pixel. |
| **Automatically play Target Audio** | Main toggle controlling whether target language audio plays at all. When off, maps to `never`. Subtitle: "When to play target language audio". |
| | Two mutually exclusive sub-options (shown when enabled): |
| | - *After submitting text* (`afterSubmit`, default): target audio plays once automatically after the user submits their text for that language. Not included in the merged audio timeline. |
| | - *After base audio* (`always`): target languages are included in the merged audio timeline, played via the main play button. The playback sequence preview updates to show target languages. |

### Scheduling

Cards skip the pre-review phase entirely. All cards are rated using FSRS ratings (Again, Hard, Good, Easy) regardless of how many times they've been seen. The `reviewCard` mutation accepts a `forceReviewPhase` flag to support this.

## Common Settings (both modes)

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
- `writingInputMode` (`'translate' | 'transcribe'`, optional, defaults to `'translate'`) — Writing input style; ignored in Shadowing
- `fullReviewTargetAudioMode` (`'always' | 'afterSubmit' | 'never'`, optional, defaults to `'afterSubmit'`)
- `ignorePunctuation` (`boolean`, optional, defaults to `false`) — exclude punctuation from the accuracy score
- `autoRateFromAccuracy` (`boolean`, optional, defaults to **`true`**) — preselect the rating from the accuracy score
- `autoRateThresholds` (`{ hard, good, easy? }`, optional, defaults to `{ hard: 50, good: 80 }`) — percent breakpoints, 0-100 integers, validated ascending on write

Accuracy stats carry both punctuation variants. `courseStats` and `dailyStats`
each gained `…StrictSum` / `…LenientSum` / `…DualCount` alongside the original
`accuracySum` / `accuracyCount`. The two sums share one count and are written
and reversed as a trio — a half-written pair would skew the average
permanently. All fields are optional and no backfill exists (or is possible:
recomputing a counterfactual score needs the typed text, which `reviewLogs`
never stored and trims after `UNDO_DEPTH` entries anyway), so the split series
simply starts at deploy. `reviewDepthAccuracy` was deliberately left on the
single series — its consumer is an `internalQuery` with no frontend reader.

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

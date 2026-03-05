# Review Modes

The `/learn` page supports two distinct review modes that users can switch between via the settings panel. The active mode is persisted per course in `courseSettings.reviewMode`.

## Audio Review Mode (default)

The original review experience. The user listens to audio playback of base and target languages, optionally with target text hidden/blurred, and rates the card based on recall.

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

## Full Review Mode

A text-input-based review where the user types the translation for each target language and sees a character-level diff of their answer against the expected text.

### Flow

1. Base language translations are shown (read-only) with audio buttons.
2. For each target language, a text input is displayed with an audio button and a submit button. When there is only one target language, the language label is hidden. When there are multiple, the full localized language name is shown.
3. The user types their answer and submits (per-language submit button, or Enter key).
4. On submit, the input is replaced inline with a diff view powered by [jsdiff](https://github.com/kpdecker/jsdiff) (`diffChars`).
   - **Green** spans: correct text (matching between expected and actual).
   - **Red** spans: mistakes (text the user added that is not in the expected text).
   - **Muted/gray** spans: missing text (expected text the user did not include).
   - An accuracy percentage is shown below the diff.
5. The audio play button remains visible after submission. The user rates the card difficulty and advances.

### Mode-specific settings

| Setting | Description |
|---------|-------------|
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
| `ReviewModeSwitcher` | `components/app/learning/ReviewModeSwitcher.tsx` | Split button at the top of settings to toggle between Audio and Full Review modes. |
| `FullReviewCardContent` | `components/app/learning/FullReviewCardContent.tsx` | Card view for full review mode with text inputs and diff display. |
| `DiffDisplay` | `components/app/learning/DiffDisplay.tsx` | Renders character-level diff between expected and actual text using jsdiff (`diffChars`). |

### Data model changes

Two fields added to the `courseSettings` table:

- `reviewMode` (`'audio' | 'full'`, optional, defaults to `'audio'`)
- `fullReviewTargetAudioMode` (`'always' | 'afterSubmit' | 'never'`, optional, defaults to `'afterSubmit'`)

### Backend changes

- `updateCourseSettings` mutation: accepts `reviewMode` and `fullReviewTargetAudioMode`.
- `reviewCard` mutation: accepts optional `forceReviewPhase` boolean. When `true`, overrides the card's scheduling phase to `'review'` so FSRS ratings are accepted for pre-review cards.

### Audio behavior

In `useLearningAudio`, when in full review mode:
- Target languages are excluded from the merged audio unless `fullReviewTargetAudioMode === 'always'`.
- Auto-advance is disabled (it is an audio-mode-only feature).
- Individual language audio playback after submit is handled inside `FullReviewCardContent` using the existing `AudioButton` mechanism.

In the settings panel, the playback sequence preview (timeline) conditionally hides target language cards and their connectors when they are not part of the main audio sequence (i.e., when the target audio setting is `afterSubmit` or `never`).

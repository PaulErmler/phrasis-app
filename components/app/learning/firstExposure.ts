import type { CourseSettings } from './types';

/**
 * Transcribe = writing mode with the input driven by target audio rather than
 * the base sentence. Used by the render path in LearningMode.
 */
export function isTranscribeMode(
  settings:
    | Pick<CourseSettings, 'reviewMode' | 'writingInputMode'>
    | null
    | undefined,
): boolean {
  return (
    (settings?.reviewMode ?? 'audio') === 'full' &&
    (settings?.writingInputMode ?? 'translate') === 'transcribe'
  );
}

/**
 * "Show translation on new sentences" (writing mode, both styles): should the
 * card render the target sentence above the input for copy-typing
 * ("Abschreiben")?
 *
 * True while the card's exposure count is below the configured window. Window
 * semantics mirror `targetBeforeOnlyNewReps`: 0 = always show (∞), 1-10 = first
 * N reviews. Defaults: enabled, N = 1 (first exposure only).
 *
 * Exposure is `max(preReviewCount + FSRS reps, freeStudyPlayCount)`. The FSRS
 * pair is the same count the "Only new" Practice-Listening limit uses, but free
 * play deliberately advances neither (advanceFreePlayCard patches only rotation
 * fields), so in the Free Study face it would stay frozen at 0 and the assist
 * would print the answer above the input on every pass of the round-robin,
 * forever. `freeStudyPlayCount` is that face's own per-card play counter, so
 * folding it in with max() lets each face retire the assist on its own
 * exposures without either one double-counting the other, mirroring how the
 * listening face folds in `radioPlayCount`.
 *
 * Applies in transcribe too (since 2026-09-02): the shown sentence is what
 * the audio says, so the first passes are copy-work rather than a test,
 * exactly as in translate. The auto-rating gate in LearningMode treats both
 * the same way, a copied answer never preselects a rating.
 */
export function shouldShowTranslationAssist(
  settings:
    | Pick<
        CourseSettings,
        'showTranslationOnNew' | 'showTranslationOnlyNewReps'
      >
    | null
    | undefined,
  preReviewCount: number,
  fsrsReps: number,
  freeStudyPlayCount = 0,
): boolean {
  if (!(settings?.showTranslationOnNew ?? true)) return false;
  const reps = settings?.showTranslationOnlyNewReps ?? 1;
  const limit = reps <= 0 ? Infinity : reps;
  const exposures = Math.max(preReviewCount + fsrsReps, freeStudyPlayCount);
  return exposures < limit;
}

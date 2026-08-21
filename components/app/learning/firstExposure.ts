import type { CourseSettings } from './types';

/**
 * Transcribe = writing mode with the input driven by target audio rather than
 * the base sentence. Shared with `shouldShowTranslationAssist`'s gate and the
 * render path in LearningMode, which need the same answer at different points
 * in the component body.
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
 * "Show translation on new sentences" (writing mode): should the card render
 * the target translation above the input for copy-typing ("Abschreiben")?
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
 * Never in transcribe mode: there the target audio IS the prompt, so printing
 * the target sentence above the input would hand over the answer (the
 * transcribe hideBaseLanguages default exists for the same reason).
 */
export function shouldShowTranslationAssist(
  settings:
    | Pick<CourseSettings, 'showTranslationOnNew' | 'showTranslationOnlyNewReps'>
    | null
    | undefined,
  preReviewCount: number,
  fsrsReps: number,
  isTranscribe = false,
  freeStudyPlayCount = 0,
): boolean {
  if (isTranscribe) return false;
  if (!(settings?.showTranslationOnNew ?? true)) return false;
  const reps = settings?.showTranslationOnlyNewReps ?? 1;
  const limit = reps <= 0 ? Infinity : reps;
  const exposures = Math.max(preReviewCount + fsrsReps, freeStudyPlayCount);
  return exposures < limit;
}

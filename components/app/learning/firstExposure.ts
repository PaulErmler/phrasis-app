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
 * True while the card's review count (preReviewCount + FSRS reps — the same
 * count the "Only new" Practice-Listening limit uses) is below the configured
 * window. Window semantics mirror `targetBeforeOnlyNewReps`: 0 = always show
 * (∞), 1-10 = first N reviews. Defaults: enabled, N = 1 (first exposure only).
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
): boolean {
  if (isTranscribe) return false;
  if (!(settings?.showTranslationOnNew ?? true)) return false;
  const reps = settings?.showTranslationOnlyNewReps ?? 1;
  const limit = reps <= 0 ? Infinity : reps;
  return preReviewCount + fsrsReps < limit;
}

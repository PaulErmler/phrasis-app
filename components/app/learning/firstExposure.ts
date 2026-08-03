import type { CourseSettings } from './types';

/**
 * "Show translation on new sentences" (writing mode): should the card render
 * the target translation above the input for copy-typing ("Abschreiben")?
 *
 * True while the card's review count (preReviewCount + FSRS reps — the same
 * count the "Only new" Practice-Listening limit uses) is below the configured
 * window. Window semantics mirror `targetBeforeOnlyNewReps`: 0 = always show
 * (∞), 1-10 = first N reviews. Defaults: enabled, N = 1 (first exposure only).
 */
export function shouldShowTranslationAssist(
  settings:
    | Pick<CourseSettings, 'showTranslationOnNew' | 'showTranslationOnlyNewReps'>
    | null
    | undefined,
  preReviewCount: number,
  fsrsReps: number,
): boolean {
  if (!(settings?.showTranslationOnNew ?? true)) return false;
  const reps = settings?.showTranslationOnlyNewReps ?? 1;
  const limit = reps <= 0 ? Infinity : reps;
  return preReviewCount + fsrsReps < limit;
}

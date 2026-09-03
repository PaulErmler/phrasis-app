/**
 * The home card's reps tile shows one of three slices of the same counters.
 * Tapping it cycles through them; the choice is persisted on `userSettings`
 * (`repsStatFilter`, unset ≡ 'all').
 *
 *   all   — every card advance (`courseStats.totalRepetitions`,
 *           `dailyStats.reps`), which merges graded reviews and free play
 *   learn     — graded FSRS reviews only (the `audio` + `full` buckets)
 *   radio     — free listening (the `radio` bucket)
 *   freeStudy — free typing practice (the `freeStudy` bucket)
 *
 * The ring order, the tile labels and the arithmetic live here rather than in
 * the component.
 */

import type { Infer } from 'convex/values';
import { reviewsByModeValidator } from '@/convex/types';
import { cycleNext } from '@/lib/cycle';

export const STAT_FILTER_CYCLE = [
  'all',
  'learn',
  'radio',
  'freeStudy',
] as const;
export type StatFilter = (typeof STAT_FILTER_CYCLE)[number];

/** i18n keys (under `AppPage`) for the Reps tile's label per face. */
export const REPS_FILTER_LABEL_KEYS = {
  all: 'stats.reps',
  learn: 'stats.repsLearn',
  radio: 'stats.repsRadio',
  freeStudy: 'stats.repsFreeStudy',
} as const satisfies Record<StatFilter, string>;

/** i18n keys (under `AppPage`) for the Time tile's label per face. */
export const TIME_FILTER_LABEL_KEYS = {
  all: 'stats.time',
  learn: 'stats.timeLearn',
  radio: 'stats.timeRadio',
  freeStudy: 'stats.timeFreeStudy',
} as const satisfies Record<StatFilter, string>;

/** Advance through STAT_FILTER_CYCLE, wrapping from 'freeStudy' back to 'all'. */
export function nextStatFilter(current: StatFilter): StatFilter {
  return cycleNext(STAT_FILTER_CYCLE, current);
}

/** Shape of `courseStats.totalReviewsByMode` / `dailyStats.reviewsByMode`. */
export type ReviewsByMode = Infer<typeof reviewsByModeValidator>;

/**
 * The number for one face, given the merged total and the per-mode breakdown
 * that accompanies it. Works for reps (`totalRepetitions` +
 * `totalReviewsByMode`) and time (`totalTimeMs` + `totalTimeMsByMode`) alike.
 *
 * Learn is derived by SUBTRACTION, not as `audio + full`. The `radio` /
 * `freeStudy` buckets are optional and rows predating them carry no split at
 * all, so the four buckets are not guaranteed to sum to the total. Subtracting
 * keeps `learn + radio + freeStudy === all` for every row, and sends
 * pre-free-play history entirely to Learn, which is what it was. The free-play
 * faces are clamped so a partially written row can neither exceed the total
 * nor push Learn negative.
 */
export function statForFilter(
  total: number,
  byMode: ReviewsByMode | undefined,
  filter: StatFilter,
): number {
  if (filter === 'all') return total;
  const radio = Math.min(byMode?.radio ?? 0, total);
  const freeStudy = Math.min(byMode?.freeStudy ?? 0, total - radio);
  if (filter === 'radio') return radio;
  if (filter === 'freeStudy') return freeStudy;
  return total - radio - freeStudy;
}

import type { FSRSRating } from './scheduling';

/**
 * Accuracy breakpoints that map a writing score to an FSRS rating.
 *
 * Percent points (0-100), lower-inclusive: a score of exactly `hard` rates
 * "hard", a score of exactly `good` rates "good". `easy` is optional, when
 * unset the top band is "good" and "easy" is only ever chosen manually.
 */
export interface AutoRateThresholds {
  hard: number;
  good: number;
  easy?: number;
}

export const DEFAULT_AUTO_RATE_THRESHOLDS: AutoRateThresholds = {
  hard: 50,
  good: 80,
};

const clampPercent = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

/**
 * Coerce a stored (or hand-edited) threshold object into something usable:
 * integers in [0, 100], in ascending order. Sorting rather than rejecting means
 * a corrupt row degrades to a working control instead of an unreachable band.
 */
export function resolveAutoRateThresholds(
  raw: Partial<AutoRateThresholds> | null | undefined,
): AutoRateThresholds {
  const hardRaw = Number.isFinite(raw?.hard)
    ? clampPercent(raw!.hard!)
    : DEFAULT_AUTO_RATE_THRESHOLDS.hard;
  const goodRaw = Number.isFinite(raw?.good)
    ? clampPercent(raw!.good!)
    : DEFAULT_AUTO_RATE_THRESHOLDS.good;

  const hard = Math.min(hardRaw, goodRaw);
  const good = Math.max(hardRaw, goodRaw);

  if (!Number.isFinite(raw?.easy)) return { hard, good };
  return { hard, good, easy: Math.max(good, clampPercent(raw!.easy!)) };
}

/**
 * Map an accuracy percentage (0-100) to a rating.
 *
 * Bands are lower-inclusive, so with the defaults: 0-49 -> again, 50-79 -> hard,
 * 80-100 -> good. The score is rounded before comparison so the rating always
 * agrees with the percentage shown under the diff. A user who sees "80%" must
 * not get "hard" because the raw value was 79.6.
 */
export function ratingForAccuracy(
  accuracy: number,
  thresholds: AutoRateThresholds = DEFAULT_AUTO_RATE_THRESHOLDS,
): FSRSRating {
  const { hard, good, easy } = resolveAutoRateThresholds(thresholds);
  const score = clampPercent(accuracy);

  if (score < hard) return 'again';
  if (score < good) return 'hard';
  if (easy != null && score >= easy) return 'easy';
  return 'good';
}

/**
 * The form call sites use. Returns `null` for "no opinion". Auto-rating off,
 * or no accuracy available yet, which threads through the existing
 * `selectedRating ?? autoRating ?? defaultRating` chain without disturbing
 * audio mode or the pre-review phase.
 */
export function autoRating(opts: {
  enabled: boolean;
  accuracy: number | null | undefined;
  thresholds?: Partial<AutoRateThresholds> | null;
}): FSRSRating | null {
  if (!opts.enabled) return null;
  if (opts.accuracy == null || !Number.isFinite(opts.accuracy)) return null;
  return ratingForAccuracy(
    opts.accuracy,
    resolveAutoRateThresholds(opts.thresholds),
  );
}

/**
 * Reject thresholds the UI could never produce. `resolveAutoRateThresholds`
 * repairs whatever is already stored, but a write is the moment to refuse bad
 * input outright. The settings slider is not the only possible writer.
 */
export function validateAutoRateThresholds(value: AutoRateThresholds): void {
  const { hard, good, easy } = value;
  const ints = easy == null ? [hard, good] : [hard, good, easy];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) {
    throw new Error('autoRateThresholds must be integers between 0 and 100');
  }
  if (hard > good || (easy != null && good > easy)) {
    throw new Error(
      'autoRateThresholds must be ascending: hard <= good <= easy',
    );
  }
}

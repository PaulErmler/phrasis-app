import { charDiff } from './charDiff';
import { alignWords } from './wordAlign';
import { scoreWordAlignment } from './score';
import { getCompareConfig, toDiffOptions } from './languageConfig';

/** 0–100 accuracy. Word-weighted for languages with word boundaries; otherwise grapheme-level. */
export function computeAccuracy(
  expected: string,
  actual: string,
  language: string = 'en',
  ignorePunctuation = false,
): number {
  const cfg = getCompareConfig(language, { ignorePunctuation });
  const diffOpts = toDiffOptions(cfg);
  if (cfg.hasWordBoundaries) {
    return Math.round(
      scoreWordAlignment(alignWords(expected, actual, diffOpts), {
        ignorePunctuation,
      }) * 100,
    );
  }
  return Math.round(charDiff(expected, actual, diffOpts).accuracy * 100);
}

export interface AccuracyPair {
  withPunctuation: number;
  withoutPunctuation: number;
}

/**
 * Both punctuation variants of the same answer, so stats can record them side
 * by side regardless of which one the learner's `ignorePunctuation` setting
 * currently displays.
 *
 * This deliberately runs two independent comparisons rather than aligning once
 * and re-scoring with the punctuation weight zeroed. `alignWords` normalizes
 * each *word* token with the same options, and `normalize` strips punctuation
 * from inside words — so `don't` becomes `dont` and `well-known` becomes
 * `wellknown`. That changes the alignment itself, not just the weights: typing
 * `dont` for `don't` is a typo worth partial credit under the strict pass but
 * an exact match under the lenient one. Re-scoring a single alignment would
 * quietly under-report the lenient score for every language that uses
 * apostrophes or hyphens.
 */
export function computeAccuracyPair(
  expected: string,
  actual: string,
  language: string = 'en',
): AccuracyPair {
  return {
    withPunctuation: computeAccuracy(expected, actual, language, false),
    withoutPunctuation: computeAccuracy(expected, actual, language, true),
  };
}

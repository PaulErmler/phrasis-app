import type { WordAlignResult } from './wordAlign';

const WEIGHT_EQUAL = 1;
const WEIGHT_TYPO = 0.7;
// Punctuation contributes a quarter of a word to the accuracy score — it
// matters (so users see a small dent for missing commas / periods) but doesn't
// dominate the percentage the way a wrong word does.
const PUNCT_WEIGHT = 0.25;

export interface ScoreOptions {
  /** Give punctuation zero weight, so it drops out of both the numerator and
   * the denominator. User setting (`courseSettings.ignorePunctuation`). */
  ignorePunctuation?: boolean;
}

/** 0–1 word-weighted accuracy. Typos get partial credit; missing/extra/wrong = 0.
 * Punctuation tokens contribute at PUNCT_WEIGHT — equal punct gives that
 * weight in full, any other tag gives zero credit but still adds to the
 * denominator — or at 0 when `ignorePunctuation` is set, which removes them
 * from the score entirely while leaving them in the diff for display. */
export function scoreWordAlignment(
  result: WordAlignResult,
  opts: ScoreOptions = {},
): number {
  const punctWeight = opts.ignorePunctuation ? 0 : PUNCT_WEIGHT;
  let expectedWeight = 0;
  let actualWeight = 0;
  let correct = 0;
  for (const w of result.words) {
    const weight = w.kind === 'punct' ? punctWeight : 1;
    switch (w.tag) {
    case 'equal':
      expectedWeight += weight;
      actualWeight += weight;
      correct += weight * WEIGHT_EQUAL;
      break;
    case 'typo':
      expectedWeight += weight;
      actualWeight += weight;
      correct += weight * WEIGHT_TYPO;
      break;
    case 'wrong':
      expectedWeight += weight;
      actualWeight += weight;
      break;
    case 'missing':
      expectedWeight += weight;
      break;
    case 'extra':
      actualWeight += weight;
      break;
    }
  }
  const denom = Math.max(expectedWeight, actualWeight);
  if (denom === 0) return 1;
  return Math.max(0, Math.min(1, correct / denom));
}

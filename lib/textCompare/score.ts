import type { WordAlignResult } from './wordAlign';

const WEIGHT_EQUAL = 1;
const WEIGHT_TYPO = 0.7;

/** 0–1 word-weighted accuracy. Typos get partial credit; missing/extra/wrong = 0. */
export function scoreWordAlignment(result: WordAlignResult): number {
  const { counts } = result;
  const expectedCount =
    counts.equal + counts.typo + counts.wrong + counts.missing;
  const actualCount = counts.equal + counts.typo + counts.wrong + counts.extra;
  const denom = Math.max(expectedCount, actualCount);
  if (denom === 0) return 1;
  const correct = counts.equal * WEIGHT_EQUAL + counts.typo * WEIGHT_TYPO;
  return Math.max(0, Math.min(1, correct / denom));
}

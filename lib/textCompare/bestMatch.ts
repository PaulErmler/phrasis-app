import { computeAccuracyPair, type AccuracyPair } from './accuracy';
import { normalizeForComparison } from './normalize';

export interface BestCandidate {
  text: string;
  pair: AccuracyPair;
}

/**
 * The one rule for "which accepted form is the answer closest to": rank by
 * the lenient (punctuation-insensitive) score, break ties by the strict
 * score, and keep the earlier candidate on a full tie (callers list the
 * card's primary sentence first). Deliberately independent of the viewer's
 * ignore-punctuation setting so the auto-rating summary, the closest-answer
 * diff and the accuracy footer always describe the same sentence — picking
 * by different metrics in different places let the score be computed
 * against a different candidate than the diff on screen.
 *
 * `computePair` lets a caller inject a cached scorer (the per-card pair
 * cache in FullReviewCardContent); it must be equivalent to
 * `computeAccuracyPair(candidate, answer, language)`.
 */
export function bestCandidate(
  candidates: readonly string[],
  answer: string,
  language: string,
  computePair: (candidate: string) => AccuracyPair = (candidate) =>
    computeAccuracyPair(candidate, answer, language),
): BestCandidate {
  let best: BestCandidate | null = null;
  for (const text of candidates) {
    const pair = computePair(text);
    if (
      !best ||
      pair.withoutPunctuation > best.pair.withoutPunctuation ||
      (pair.withoutPunctuation === best.pair.withoutPunctuation &&
        pair.withPunctuation > best.pair.withPunctuation)
    ) {
      best = { text, pair };
    }
  }
  if (!best) throw new Error('bestCandidate: empty candidate list');
  return best;
}

/**
 * Client mirror of the server's free local gate (`writingAnswersMatch` in
 * convex/features/writingFeedback.ts): punctuation/case/whitespace-
 * insensitive EQUALITY, sharing the server's exact normalizer. Deliberately
 * not a rounded accuracy score: `computeAccuracy(...) >= 100` rounds, so a
 * one-character typo in a long sentence hit 100 and short-circuited the
 * grader the server's gate is documented to hand such answers to ("a
 * one-character typo should reach the LLM and come back as a 'minor'
 * verdict"). The zh/ko romanized-equality half of the server gate is
 * server-only (it needs the romanizer); those answers make one grader call
 * and come back `verdict: 'correct'` without consuming quota.
 */
export function answersMatchExactly(expected: string, answer: string): boolean {
  return normalizeForComparison(expected) === normalizeForComparison(answer);
}

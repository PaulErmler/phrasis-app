import { describe, it, expect } from 'vitest';

import { shouldShowTranslationAssist } from '@/components/app/learning/firstExposure';

/**
 * "Show translation on new sentences" predicate: enabled-by-default, window
 * counts preReviewCount + FSRS reps against showTranslationOnlyNewReps with
 * the same 0-means-∞ convention as the Practice-Listening "Only new" limit.
 */
describe('shouldShowTranslationAssist', () => {
  it('defaults to showing on the first exposure only', () => {
    expect(shouldShowTranslationAssist(undefined, 0, 0)).toBe(true);
    expect(shouldShowTranslationAssist(undefined, 1, 0)).toBe(false);
    expect(shouldShowTranslationAssist(undefined, 0, 1)).toBe(false);
    expect(shouldShowTranslationAssist({}, 0, 0)).toBe(true);
  });

  it('is off when the toggle is disabled, regardless of count', () => {
    expect(
      shouldShowTranslationAssist({ showTranslationOnNew: false }, 0, 0),
    ).toBe(false);
  });

  it('respects a wider rep window', () => {
    const settings = { showTranslationOnlyNewReps: 3 };
    expect(shouldShowTranslationAssist(settings, 2, 0)).toBe(true);
    expect(shouldShowTranslationAssist(settings, 2, 1)).toBe(false);
  });

  it('treats 0 reps as always show (∞)', () => {
    const settings = { showTranslationOnlyNewReps: 0 };
    expect(shouldShowTranslationAssist(settings, 50, 50)).toBe(true);
  });

  it('counts pre-review rounds and FSRS reps together', () => {
    const settings = { showTranslationOnlyNewReps: 2 };
    expect(shouldShowTranslationAssist(settings, 1, 0)).toBe(true);
    expect(shouldShowTranslationAssist(settings, 1, 1)).toBe(false);
  });
});

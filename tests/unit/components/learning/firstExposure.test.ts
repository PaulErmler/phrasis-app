import { describe, it, expect } from 'vitest';

import {
  isTranscribeMode,
  shouldShowTranslationAssist,
} from '@/components/app/learning/firstExposure';

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

  it('never shows in transcribe mode — the shown target would BE the answer', () => {
    // Even with the widest window (0 = always) and a brand-new card.
    expect(
      shouldShowTranslationAssist({ showTranslationOnlyNewReps: 0 }, 0, 0, true),
    ).toBe(false);
    expect(shouldShowTranslationAssist(undefined, 0, 0, true)).toBe(false);
    // Explicit false matches the default-arg behaviour.
    expect(shouldShowTranslationAssist(undefined, 0, 0, false)).toBe(true);
  });

  // Free play advances neither preReviewCount nor the FSRS reps, so without
  // its own counter the assist would print the answer above the input on every
  // pass of the Free Study round-robin, forever.
  it('retires in Free Study on freeStudyPlayCount alone', () => {
    // First pass: never played anywhere.
    expect(shouldShowTranslationAssist(undefined, 0, 0, false, 0)).toBe(true);
    // Second pass: the advance bumped freeStudyPlayCount, FSRS still frozen.
    expect(shouldShowTranslationAssist(undefined, 0, 0, false, 1)).toBe(false);
  });

  it('takes the max of FSRS exposures and free-study plays, not their sum', () => {
    const settings = { showTranslationOnlyNewReps: 3 };
    // 2 FSRS exposures + 2 free-study plays must not read as 4 and retire early
    // — each face retires the assist on its own exposures.
    expect(shouldShowTranslationAssist(settings, 1, 1, false, 2)).toBe(true);
    expect(shouldShowTranslationAssist(settings, 1, 2, false, 0)).toBe(false);
    expect(shouldShowTranslationAssist(settings, 0, 0, false, 3)).toBe(false);
  });

  it('defaults freeStudyPlayCount to 0 so FSRS-only callers are unchanged', () => {
    expect(shouldShowTranslationAssist(undefined, 0, 0)).toBe(true);
    expect(shouldShowTranslationAssist(undefined, 1, 0)).toBe(false);
  });
});

/**
 * Shared transcribe predicate — used by both the auto-rating gate in
 * LearningMode (before its early returns) and the render path (after them),
 * so the two can't disagree about whether a card is copy-through.
 */
describe('isTranscribeMode', () => {
  it('is true only for writing mode with the transcribe input', () => {
    expect(
      isTranscribeMode({ reviewMode: 'full', writingInputMode: 'transcribe' }),
    ).toBe(true);
  });

  it('is false for writing mode with the default translate input', () => {
    expect(isTranscribeMode({ reviewMode: 'full' })).toBe(false);
    expect(
      isTranscribeMode({ reviewMode: 'full', writingInputMode: 'translate' }),
    ).toBe(false);
  });

  it('is false for audio mode even when the input mode says transcribe', () => {
    expect(isTranscribeMode({ writingInputMode: 'transcribe' })).toBe(false);
    expect(
      isTranscribeMode({ reviewMode: 'audio', writingInputMode: 'transcribe' }),
    ).toBe(false);
  });

  it('handles null/undefined settings as the audio-mode default', () => {
    expect(isTranscribeMode(null)).toBe(false);
    expect(isTranscribeMode(undefined)).toBe(false);
  });
});

/**
 * The auto-rating gate. A copy-through card prints the target above the input,
 * so a verbatim copy scores 100% — that must not preselect a rating (with
 * instantProceed it would graduate the card on a copy) nor reach the accuracy
 * series. This mirrors the `autoRateEnabled` expression in LearningMode.
 */
describe('auto-rating suppression on copy-through cards', () => {
  const autoRateEnabled = (
    settings: Parameters<typeof isTranscribeMode>[0] & {
      autoRateFromAccuracy?: boolean;
      showTranslationOnNew?: boolean;
      showTranslationOnlyNewReps?: number;
    },
    preReviewCount: number,
    fsrsReps: number,
  ) =>
    (settings?.reviewMode ?? 'audio') === 'full' &&
    (settings?.autoRateFromAccuracy ?? true) &&
    !shouldShowTranslationAssist(
      settings,
      preReviewCount,
      fsrsReps,
      isTranscribeMode(settings),
    );

  it('is suppressed on a brand-new writing card (the assist is showing)', () => {
    expect(autoRateEnabled({ reviewMode: 'full' }, 0, 0)).toBe(false);
  });

  it('resumes once the card is past its assist window', () => {
    expect(autoRateEnabled({ reviewMode: 'full' }, 1, 0)).toBe(true);
  });

  it('is never suppressed in transcribe mode — no assist is shown there', () => {
    expect(
      autoRateEnabled(
        { reviewMode: 'full', writingInputMode: 'transcribe' },
        0,
        0,
      ),
    ).toBe(true);
  });

  it('is not suppressed when the user turned the assist off', () => {
    expect(
      autoRateEnabled({ reviewMode: 'full', showTranslationOnNew: false }, 0, 0),
    ).toBe(true);
  });

  it('stays suppressed for the whole window when it is widened', () => {
    const s = { reviewMode: 'full' as const, showTranslationOnlyNewReps: 3 };
    expect(autoRateEnabled(s, 0, 0)).toBe(false);
    expect(autoRateEnabled(s, 2, 0)).toBe(false);
    expect(autoRateEnabled(s, 3, 0)).toBe(true);
  });
});

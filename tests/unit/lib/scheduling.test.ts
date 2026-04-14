import { describe, it, expect } from 'vitest';
import {
  getPreReviewInterval,
  createInitialCardState,
  getValidRatings,
  getDefaultRating,
  formatInterval,
  scheduleCard,
  simulateReviews,
  validateInitialReviewCount,
  DEFAULT_INITIAL_REVIEW_COUNT,
  MIN_INITIAL_REVIEW_COUNT,
  MAX_INITIAL_REVIEW_COUNT,
} from '@/lib/scheduling';

describe('validateInitialReviewCount', () => {
  it('accepts values inside range', () => {
    expect(() => validateInitialReviewCount(MIN_INITIAL_REVIEW_COUNT)).not.toThrow();
    expect(() => validateInitialReviewCount(DEFAULT_INITIAL_REVIEW_COUNT)).not.toThrow();
    expect(() => validateInitialReviewCount(MAX_INITIAL_REVIEW_COUNT)).not.toThrow();
  });

  it('rejects values outside range and non-integers', () => {
    expect(() => validateInitialReviewCount(MIN_INITIAL_REVIEW_COUNT - 1)).toThrow();
    expect(() => validateInitialReviewCount(MAX_INITIAL_REVIEW_COUNT + 1)).toThrow();
    expect(() => validateInitialReviewCount(3.5)).toThrow();
    expect(() => validateInitialReviewCount(Number.NaN)).toThrow();
  });
});

describe('getPreReviewInterval', () => {
  it('returns the explicit intervals for the first steps', () => {
    expect(getPreReviewInterval(0)).toBe(60_000);
    expect(getPreReviewInterval(1)).toBe(3 * 60_000);
    expect(getPreReviewInterval(2)).toBe(5 * 60_000);
  });

  it('falls back to 10 min after the table is exhausted', () => {
    expect(getPreReviewInterval(3)).toBe(10 * 60_000);
    expect(getPreReviewInterval(99)).toBe(10 * 60_000);
  });
});

describe('createInitialCardState', () => {
  it('starts in preReview with zero count', () => {
    const s = createInitialCardState(1000);
    expect(s.schedulingPhase).toBe('preReview');
    expect(s.preReviewCount).toBe(0);
    expect(s.dueDate).toBe(1000);
    expect(s.fsrsState).toBeNull();
  });
});

describe('getValidRatings / getDefaultRating', () => {
  it('returns preReview ratings', () => {
    expect(getValidRatings('preReview')).toEqual([
      'stillLearning',
      'understood',
    ]);
    expect(getDefaultRating('preReview')).toBe('stillLearning');
  });

  it('returns FSRS ratings for review phase', () => {
    expect(getValidRatings('review')).toEqual(['again', 'hard', 'good', 'easy']);
    expect(getDefaultRating('review')).toBe('good');
  });
});

describe('formatInterval', () => {
  it('formats minutes', () => {
    expect(formatInterval(60_000)).toBe('1m');
    expect(formatInterval(30 * 60_000)).toBe('30m');
  });

  it('formats hours', () => {
    expect(formatInterval(2 * 3_600_000)).toBe('2h');
  });

  it('formats days', () => {
    expect(formatInterval(3 * 86_400_000)).toBe('3d');
  });
});

describe('scheduleCard (pre-review phase)', () => {
  const now = 1_000_000;

  it('stays in preReview when count is below threshold', () => {
    const state = createInitialCardState(now);
    const r = scheduleCard(state, 'stillLearning', 5, now);
    expect(r.schedulingPhase).toBe('preReview');
    expect(r.preReviewCount).toBe(1);
    expect(r.phaseTransitioned).toBe(false);
    expect(r.fsrsState).toBeNull();
    expect(r.dueDate).toBe(now + 60_000);
  });

  it('transitions to review on "understood"', () => {
    const state = createInitialCardState(now);
    const r = scheduleCard(state, 'understood', 5, now);
    expect(r.schedulingPhase).toBe('review');
    expect(r.phaseTransitioned).toBe(true);
    expect(r.fsrsState).not.toBeNull();
  });

  it('transitions when preReviewCount reaches threshold', () => {
    // threshold = initialReviewCount - 2; with init=5 → threshold=3
    const state = {
      schedulingPhase: 'preReview' as const,
      preReviewCount: 2,
      dueDate: now,
      fsrsState: null,
    };
    const r = scheduleCard(state, 'stillLearning', 5, now);
    expect(r.schedulingPhase).toBe('review');
    expect(r.phaseTransitioned).toBe(true);
  });
});

describe('simulateReviews', () => {
  it('produces one step per rating', () => {
    const steps = simulateReviews(5, ['stillLearning', 'stillLearning', 'understood'], 0);
    expect(steps).toHaveLength(3);
    expect(steps[0].reviewNumber).toBe(1);
    expect(steps[2].reviewNumber).toBe(3);
  });

  it('reflects the phase transition in a step', () => {
    const steps = simulateReviews(5, ['understood'], 0);
    expect(steps[0].phaseTransitioned).toBe(true);
    expect(steps[0].phase).toBe('review');
  });

  it('every step has an interval description', () => {
    const steps = simulateReviews(5, ['stillLearning', 'stillLearning']);
    for (const s of steps) {
      expect(s.intervalDescription).toMatch(/^\d/);
    }
  });
});

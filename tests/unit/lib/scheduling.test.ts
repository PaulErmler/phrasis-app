import { describe, it, expect } from 'vitest';
import {
  getPreReviewInterval,
  createInitialCardState,
  getValidRatings,
  getDefaultRating,
  formatInterval,
  scheduleCard,
  simulateReviews,
  clampInitialReviewCount,
  DEFAULT_INITIAL_REVIEW_COUNT,
  MIN_INITIAL_REVIEW_COUNT,
  MAX_INITIAL_REVIEW_COUNT,
  DUE_SLOT_WINDOW_MS,
  isInsideSlotWindow,
  studyDayStart,
  type CardSchedulingState,
  type StudyDay,
} from '@/lib/scheduling';

describe('clampInitialReviewCount', () => {
  it('passes values inside range through unchanged', () => {
    expect(clampInitialReviewCount(MIN_INITIAL_REVIEW_COUNT)).toBe(
      MIN_INITIAL_REVIEW_COUNT,
    );
    expect(clampInitialReviewCount(DEFAULT_INITIAL_REVIEW_COUNT)).toBe(
      DEFAULT_INITIAL_REVIEW_COUNT,
    );
    expect(clampInitialReviewCount(MAX_INITIAL_REVIEW_COUNT)).toBe(
      MAX_INITIAL_REVIEW_COUNT,
    );
  });

  it('clamps out-of-range values to the supported bounds', () => {
    expect(clampInitialReviewCount(MIN_INITIAL_REVIEW_COUNT - 1)).toBe(
      MIN_INITIAL_REVIEW_COUNT,
    );
    expect(clampInitialReviewCount(MAX_INITIAL_REVIEW_COUNT + 10)).toBe(
      MAX_INITIAL_REVIEW_COUNT,
    );
  });

  it('floors non-integers and defaults non-finite input', () => {
    expect(clampInitialReviewCount(3.5)).toBe(3);
    expect(clampInitialReviewCount(Number.NaN)).toBe(
      DEFAULT_INITIAL_REVIEW_COUNT,
    );
    expect(clampInitialReviewCount(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_INITIAL_REVIEW_COUNT,
    );
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
    expect(getValidRatings('review')).toEqual([
      'again',
      'hard',
      'good',
      'easy',
    ]);
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
    const steps = simulateReviews(
      5,
      ['stillLearning', 'stillLearning', 'understood'],
      0,
    );
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

// ============================================================================
// Study-day snapping
// ============================================================================

const T = (iso: string) => Date.parse(iso);
const BERLIN: StudyDay = { timezone: 'Europe/Berlin', dayStartHour: 4 };
const LA: StudyDay = { timezone: 'America/Los_Angeles', dayStartHour: 4 };

describe('studyDayStart', () => {
  it('returns the most recent rollover hour at or before the instant', () => {
    // 14:00 CEST → 04:00 CEST the same day (02:00Z).
    expect(studyDayStart(T('2026-09-10T12:00:00Z'), BERLIN)).toBe(
      T('2026-09-10T02:00:00Z'),
    );
    // 03:30 CEST is still the previous study day.
    expect(studyDayStart(T('2026-09-10T01:30:00Z'), BERLIN)).toBe(
      T('2026-09-09T02:00:00Z'),
    );
    // Exactly 04:00 starts its own day.
    expect(studyDayStart(T('2026-09-10T02:00:00Z'), BERLIN)).toBe(
      T('2026-09-10T02:00:00Z'),
    );
    // 13:00 PDT → 04:00 PDT (11:00Z).
    expect(studyDayStart(T('2026-09-10T20:00:00Z'), LA)).toBe(
      T('2026-09-10T11:00:00Z'),
    );
  });

  it('lands on the wall-clock hour across DST transitions', () => {
    // Fall back 2026-10-25 (CEST → CET at 01:00Z): 04:00 CET is 03:00Z.
    expect(studyDayStart(T('2026-10-25T12:00:00Z'), BERLIN)).toBe(
      T('2026-10-25T03:00:00Z'),
    );
    // 03:30 CET (02:30Z) on the 25-hour day is still the previous day,
    // which started at 04:00 CEST (02:00Z on the 24th).
    expect(studyDayStart(T('2026-10-25T02:30:00Z'), BERLIN)).toBe(
      T('2026-10-24T02:00:00Z'),
    );
    // Spring forward 2026-03-29 (CET → CEST at 01:00Z): 04:00 CEST is 02:00Z.
    expect(studyDayStart(T('2026-03-29T12:00:00Z'), BERLIN)).toBe(
      T('2026-03-29T02:00:00Z'),
    );
    // 04:30 CEST (02:30Z) on the 23-hour day belongs to that day.
    expect(studyDayStart(T('2026-03-29T02:30:00Z'), BERLIN)).toBe(
      T('2026-03-29T02:00:00Z'),
    );
    // 03:30 CET (02:30Z) on the 28th is before that day's 04:00 CET (03:00Z).
    expect(studyDayStart(T('2026-03-28T02:30:00Z'), BERLIN)).toBe(
      T('2026-03-27T03:00:00Z'),
    );
  });

  it('honours a different rollover hour', () => {
    const midnight: StudyDay = { timezone: 'Europe/Berlin', dayStartHour: 0 };
    expect(studyDayStart(T('2026-09-10T12:00:00Z'), midnight)).toBe(
      T('2026-09-09T22:00:00Z'),
    );
    const noon: StudyDay = { timezone: 'UTC', dayStartHour: 12 };
    expect(studyDayStart(T('2026-09-10T11:59:59Z'), noon)).toBe(
      T('2026-09-09T12:00:00Z'),
    );
  });
});

describe('isInsideSlotWindow', () => {
  const start = T('2026-09-10T02:00:00Z');
  it('is the first minute of the study day, half-open', () => {
    expect(isInsideSlotWindow(start, BERLIN)).toBe(true);
    expect(isInsideSlotWindow(start + DUE_SLOT_WINDOW_MS - 1, BERLIN)).toBe(
      true,
    );
    expect(isInsideSlotWindow(start + DUE_SLOT_WINDOW_MS, BERLIN)).toBe(false);
    expect(isInsideSlotWindow(start - 1, BERLIN)).toBe(false);
    expect(isInsideSlotWindow(start + 10 * 3_600_000, BERLIN)).toBe(false);
  });
});

describe('scheduleCard with a study day', () => {
  const DAY = 86_400_000;
  const reviewState = (now: number, stability = 20): CardSchedulingState => ({
    schedulingPhase: 'review',
    preReviewCount: 0,
    dueDate: now - 1000,
    fsrsState: {
      due: now - 1000,
      stability,
      difficulty: 4,
      elapsedDays: 3,
      scheduledDays: 3,
      learningSteps: 0,
      reps: 5,
      lapses: 0,
      state: 2,
      lastReview: now - 3 * DAY,
    },
  });

  it('snaps a day-scale result to the study-day start and flags it', () => {
    const now = T('2026-09-10T12:07:00Z'); // 14:07 CEST
    const r = scheduleCard(reviewState(now), 'good', 5, now, undefined, BERLIN);
    expect(r.snappedToStudyDay).toBe(true);
    expect(r.fsrsState!.scheduledDays).toBeGreaterThanOrEqual(1);
    // FSRS's own instant keeps the review's clock time...
    const exact = r.fsrsState!.due;
    expect(exact % DAY).toBe(now % DAY);
    // ...and the served due date is the 04:00 CEST that precedes it.
    expect(r.dueDate).toBe(studyDayStart(exact, BERLIN));
    expect(r.dueDate).toBeLessThan(exact);
    expect(exact - r.dueDate).toBeLessThan(DAY);
    expect(new Date(r.dueDate).toISOString()).toMatch(/T02:00:00\.000Z$/);
  });

  it('a short interval rated before rollover lands at 04:00 of the right morning', () => {
    // 03:30 CEST on the 10th with a weak card: 3 days → exact due 03:30
    // CEST on the 13th, which is before rollover, so the study day that
    // contains it started at 04:00 on the 12th.
    const now = T('2026-09-10T01:30:00Z');
    const r = scheduleCard(
      reviewState(now, 0.5),
      'good',
      5,
      now,
      undefined,
      BERLIN,
    );
    expect(r.fsrsState!.scheduledDays).toBe(3);
    expect(r.fsrsState!.due).toBe(T('2026-09-13T01:30:00Z'));
    expect(r.dueDate).toBe(T('2026-09-12T02:00:00Z'));
  });

  it('snaps long intervals and other zones the same way', () => {
    // 13:07 PDT on the 10th, strong card → weeks out, due at 04:00 PDT.
    const now = T('2026-09-10T20:07:00Z');
    const r = scheduleCard(
      reviewState(now, 200),
      'easy',
      5,
      now,
      undefined,
      LA,
    );
    expect(r.fsrsState!.scheduledDays).toBeGreaterThanOrEqual(30);
    expect(r.dueDate).toBe(studyDayStart(r.fsrsState!.due, LA));
    // 04:00 on the wall clock whichever offset LA is on by then.
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(r.dueDate));
    expect(local).toBe('04:00');
    expect(r.fsrsState!.due - r.dueDate).toBeLessThan(DAY);
  });

  it('never lands in the past on a 25-hour DST day: moves to the next study day', () => {
    // 04:30 CEST on 2026-10-24, the eve of fall-back. A 1-day interval is
    // exact-due 03:30 CET on the 25th, which is still the study day that
    // started at 04:00 CEST on the 24th, i.e. 30 minutes ago. Snapping
    // there would re-serve the card at once on every rating for an hour.
    const now = T('2026-10-24T02:30:00Z');
    const r = scheduleCard(
      reviewState(now, 0.3),
      'hard',
      5,
      now,
      undefined,
      BERLIN,
    );
    expect(r.fsrsState!.scheduledDays).toBe(1);
    expect(studyDayStart(r.fsrsState!.due, BERLIN)).toBeLessThan(now);
    expect(r.dueDate).toBe(T('2026-10-25T03:00:00Z')); // 04:00 CET
    expect(r.snappedToStudyDay).toBe(true);
  });

  it('leaves the relearning step exact: Again on a graduated card', () => {
    const now = T('2026-09-10T12:07:00Z');
    const r = scheduleCard(
      reviewState(now),
      'again',
      5,
      now,
      undefined,
      BERLIN,
    );
    expect(r.snappedToStudyDay).toBeUndefined();
    expect(r.fsrsState!.scheduledDays).toBe(0);
    expect(r.dueDate).toBe(now + 10 * 60_000);
  });

  it('leaves the pre-review table exact', () => {
    const now = T('2026-09-10T12:07:00Z');
    const r = scheduleCard(
      createInitialCardState(now),
      'stillLearning',
      5,
      now,
      undefined,
      BERLIN,
    );
    expect(r.snappedToStudyDay).toBeUndefined();
    expect(r.dueDate).toBe(now + 60_000);
  });

  it('is identical to the exact-instant path without a study day', () => {
    const now = T('2026-09-10T12:07:00Z');
    const plain = scheduleCard(reviewState(now), 'good', 5, now);
    const explicit = scheduleCard(
      reviewState(now),
      'good',
      5,
      now,
      undefined,
      undefined,
    );
    expect(explicit).toEqual(plain);
    expect(plain.snappedToStudyDay).toBeUndefined();
    expect(plain.dueDate).toBe(plain.fsrsState!.due);
  });
});

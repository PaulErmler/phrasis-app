import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AUTO_RATE_THRESHOLDS,
  autoRating,
  ratingForAccuracy,
  resolveAutoRateThresholds,
} from '@/lib/autoRating';

describe('ratingForAccuracy', () => {
  it('maps the default bands, lower-inclusive at each boundary', () => {
    // The boundaries are the whole feature: 50 belongs to "hard", not "again",
    // and 80 belongs to "good", not "hard".
    const cases: Array<[number, string]> = [
      [0, 'again'],
      [49, 'again'],
      [50, 'hard'],
      [79, 'hard'],
      [80, 'good'],
      [100, 'good'],
    ];
    for (const [accuracy, expected] of cases) {
      expect(ratingForAccuracy(accuracy)).toBe(expected);
    }
  });

  it('rounds before comparing so the rating matches the displayed percentage', () => {
    // The diff footer rounds for display. A user who sees "80%" must not get
    // "hard" because the raw score was 79.6.
    expect(ratingForAccuracy(79.6)).toBe('good');
    expect(ratingForAccuracy(79.4)).toBe('hard');
    expect(ratingForAccuracy(49.5)).toBe('hard');
  });

  it('honours custom thresholds', () => {
    const strict = { hard: 60, good: 90 };
    expect(ratingForAccuracy(59, strict)).toBe('again');
    expect(ratingForAccuracy(60, strict)).toBe('hard');
    expect(ratingForAccuracy(89, strict)).toBe('hard');
    expect(ratingForAccuracy(90, strict)).toBe('good');
  });

  it('handles degenerate bands without producing an unreachable rating', () => {
    // Empty "hard" band: every score is either again or good.
    expect(ratingForAccuracy(59, { hard: 60, good: 60 })).toBe('again');
    expect(ratingForAccuracy(60, { hard: 60, good: 60 })).toBe('good');
    // hard at 0 means "again" is never selected.
    expect(ratingForAccuracy(0, { hard: 0, good: 80 })).toBe('hard');
  });

  it('returns easy only when an easy threshold is configured', () => {
    expect(ratingForAccuracy(100)).toBe('good');
    expect(ratingForAccuracy(100, { hard: 50, good: 80, easy: 97 })).toBe(
      'easy',
    );
    expect(ratingForAccuracy(96, { hard: 50, good: 80, easy: 97 })).toBe(
      'good',
    );
  });
});

describe('resolveAutoRateThresholds', () => {
  it('falls back to the defaults for missing or unusable input', () => {
    expect(resolveAutoRateThresholds(undefined)).toEqual(
      DEFAULT_AUTO_RATE_THRESHOLDS,
    );
    expect(resolveAutoRateThresholds(null)).toEqual(
      DEFAULT_AUTO_RATE_THRESHOLDS,
    );
    expect(resolveAutoRateThresholds({ hard: NaN, good: NaN })).toEqual(
      DEFAULT_AUTO_RATE_THRESHOLDS,
    );
  });

  it('sorts an inverted pair rather than rejecting it', () => {
    expect(resolveAutoRateThresholds({ hard: 90, good: 20 })).toEqual({
      hard: 20,
      good: 90,
    });
  });

  it('clamps out-of-range values into 0-100 and rounds to integers', () => {
    expect(resolveAutoRateThresholds({ hard: -5, good: 300 })).toEqual({
      hard: 0,
      good: 100,
    });
    expect(resolveAutoRateThresholds({ hard: 49.6, good: 80.2 })).toEqual({
      hard: 50,
      good: 80,
    });
  });

  it('never lets easy fall below good', () => {
    expect(resolveAutoRateThresholds({ hard: 50, good: 80, easy: 60 })).toEqual(
      {
        hard: 50,
        good: 80,
        easy: 80,
      },
    );
  });
});

describe('autoRating', () => {
  it('has no opinion when disabled', () => {
    expect(autoRating({ enabled: false, accuracy: 10 })).toBeNull();
  });

  it('has no opinion when the accuracy is missing or not finite', () => {
    expect(autoRating({ enabled: true, accuracy: null })).toBeNull();
    expect(autoRating({ enabled: true, accuracy: undefined })).toBeNull();
    expect(autoRating({ enabled: true, accuracy: NaN })).toBeNull();
    expect(autoRating({ enabled: true, accuracy: Infinity })).toBeNull();
  });

  it('rates when enabled and an accuracy is available', () => {
    expect(autoRating({ enabled: true, accuracy: 30 })).toBe('again');
    expect(autoRating({ enabled: true, accuracy: 65 })).toBe('hard');
    expect(autoRating({ enabled: true, accuracy: 95 })).toBe('good');
  });

  it('tolerates a partial or corrupt stored threshold object', () => {
    expect(
      autoRating({
        enabled: true,
        accuracy: 65,
        thresholds: { hard: 90, good: 20 },
      }),
    ).toBe('hard');
    expect(autoRating({ enabled: true, accuracy: 65, thresholds: {} })).toBe(
      'hard',
    );
  });
});

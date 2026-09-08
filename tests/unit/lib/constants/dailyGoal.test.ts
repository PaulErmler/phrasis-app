import { describe, it, expect } from 'vitest';

import {
  DAILY_TIME_CUSTOM_MIN,
  DAILY_TIME_CUSTOM_MAX,
  DAILY_TIME_PRESETS,
  clampDailyGoal,
  isPresetGoal,
  parseCustomGoal,
} from '@/lib/constants/dailyGoal';

/**
 * The custom daily goal window is the one thing three editors and four Convex
 * write paths all derive from (three through `clampDailyGoal`, plus
 * `finalizeOnboarding`, which hand-rolls the same rule), so the bounds and the
 * two helpers that enforce them are pinned here rather than only end-to-end in
 * the Convex suites. Cases are written against the constants, not literals, so raising
 * the ceiling again does not silently invalidate them.
 */
describe('daily goal bounds', () => {
  it('allows a full 24-hour day', () => {
    expect(DAILY_TIME_CUSTOM_MAX).toBe(24 * 60);
  });

  it('keeps every preset inside the window', () => {
    for (const preset of DAILY_TIME_PRESETS) {
      expect(preset).toBeGreaterThanOrEqual(DAILY_TIME_CUSTOM_MIN);
      expect(preset).toBeLessThanOrEqual(DAILY_TIME_CUSTOM_MAX);
      expect(isPresetGoal(preset)).toBe(true);
    }
    expect(isPresetGoal(DAILY_TIME_CUSTOM_MAX)).toBe(false);
    expect(isPresetGoal(null)).toBe(false);
  });
});

describe('parseCustomGoal', () => {
  it('accepts both ends of the window', () => {
    expect(parseCustomGoal(String(DAILY_TIME_CUSTOM_MIN))).toBe(
      DAILY_TIME_CUSTOM_MIN,
    );
    expect(parseCustomGoal(String(DAILY_TIME_CUSTOM_MAX))).toBe(
      DAILY_TIME_CUSTOM_MAX,
    );
  });

  it('rejects values outside it, and anything unparseable', () => {
    expect(parseCustomGoal(String(DAILY_TIME_CUSTOM_MIN - 1))).toBeNull();
    expect(parseCustomGoal(String(DAILY_TIME_CUSTOM_MAX + 1))).toBeNull();
    expect(parseCustomGoal('')).toBeNull();
    expect(parseCustomGoal('abc')).toBeNull();
  });
});

describe('clampDailyGoal', () => {
  it('pulls out-of-range values to the nearest bound', () => {
    expect(clampDailyGoal(0)).toBe(DAILY_TIME_CUSTOM_MIN);
    expect(clampDailyGoal(DAILY_TIME_CUSTOM_MAX + 1)).toBe(
      DAILY_TIME_CUSTOM_MAX,
    );
    expect(clampDailyGoal(DAILY_TIME_CUSTOM_MAX)).toBe(DAILY_TIME_CUSTOM_MAX);
  });

  it('rounds fractions', () => {
    expect(clampDailyGoal(14.6)).toBe(15);
  });

  // Non-finite values survive Math.max/min/round and Convex stores them as
  // float64, where a poisoned goal breaks the home ring until repaired by
  // hand. They are dropped rather than clamped.
  it('drops undefined and non-finite values', () => {
    expect(clampDailyGoal(undefined)).toBeUndefined();
    expect(clampDailyGoal(Number.NaN)).toBeUndefined();
    expect(clampDailyGoal(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(clampDailyGoal(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * The forecast's localStorage key must carry `today`.
 *
 * Every date the card renders is derived from the cached payload's own
 * `today`, so a payload written yesterday paints yesterday's seven days with
 * the day-0 bar labelled "Today" until the live query lands. Keying the date
 * in makes a stale entry unreachable instead of wrong, and the hook prunes
 * the entries that keying leaves behind.
 */

let currentToday = '2026-08-28';
vi.mock('@/lib/dateStrings', () => ({
  dateInTimezone: () => currentToday,
}));

vi.mock('@/lib/timezone', () => ({
  getUserTimezone: () => 'Europe/Berlin',
}));

vi.mock('@/hooks/use-now-minute', () => ({
  useNowMinute: () => 1_787_000_000_000,
}));

vi.mock('convex/react', () => ({
  usePreloadedQuery: () => ({ hideWorkloadForecast: false }),
}));

vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({
    courseSettings: {
      courseId: 'course_1',
      reviewMode: 'audio',
      studyContentFilter: 'both',
    },
    preloadedSettings: {},
  }),
}));

const cacheKeys: string[] = [];
vi.mock('@/hooks/use-cached-query', () => ({
  useCachedQuery: (_query: unknown, _args: unknown, cacheKey: string) => {
    cacheKeys.push(cacheKey);
    return undefined;
  },
}));

const { useWorkloadForecast } = await import('@/hooks/use-workload-forecast');

describe('useWorkloadForecast cache key', () => {
  beforeEach(() => {
    cacheKeys.length = 0;
    currentToday = '2026-08-28';
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('ends the key with today, so yesterday cannot be read back', () => {
    renderHook(() => useWorkloadForecast());
    expect(cacheKeys.at(-1)).toMatch(/_2026-08-28$/);
  });

  it('changes the key when the day rolls over', () => {
    const { rerender } = renderHook(() => useWorkloadForecast());
    const dayOne = cacheKeys.at(-1);

    currentToday = '2026-08-29';
    rerender();
    const dayTwo = cacheKeys.at(-1);

    expect(dayTwo).not.toBe(dayOne);
    expect(dayTwo).toMatch(/_2026-08-29$/);
  });

  it('keeps the key stable across re-renders on the same day', () => {
    const { rerender } = renderHook(() => useWorkloadForecast());
    const first = cacheKeys.at(-1);
    rerender();
    expect(cacheKeys.at(-1)).toBe(first);
  });

  it('prunes forecast entries from other days, keeping today and foreign keys', () => {
    localStorage.setItem('workload_v2_course_1_audio_both_2026-08-27', '{}');
    localStorage.setItem('workload_v2_course_9_full_both_2026-08-20', '{}');
    localStorage.setItem('workload_v2_course_1_audio_both_2026-08-28', '{}');
    localStorage.setItem('unrelated_key', 'keep me');

    renderHook(() => useWorkloadForecast());

    expect(
      localStorage.getItem('workload_v2_course_1_audio_both_2026-08-27'),
    ).toBeNull();
    expect(
      localStorage.getItem('workload_v2_course_9_full_both_2026-08-20'),
    ).toBeNull();
    // Today's entry for another course/mode is still today's: not stale.
    expect(
      localStorage.getItem('workload_v2_course_1_audio_both_2026-08-28'),
    ).toBe('{}');
    expect(localStorage.getItem('unrelated_key')).toBe('keep me');
  });
});

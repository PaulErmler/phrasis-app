import { describe, it, expect } from 'vitest';
import {
  accumulateFromTotal,
  addMonths,
  monthsBetween,
  quarterKeyOf,
  yearViewBuckets,
} from '@/components/app/stats/cumulativeSeries';

describe('accumulateFromTotal', () => {
  it('starts at the total from before the window and ends at the total', () => {
    // 327 words all time, 252 of them inside the window.
    expect(accumulateFromTotal([0, 132, 93, 27, 0], 327)).toEqual([
      75, 207, 300, 327, 327,
    ]);
  });

  it('is a flat line at the total when the window has no activity', () => {
    expect(accumulateFromTotal([0, 0, 0], 71)).toEqual([71, 71, 71]);
  });

  it('never starts below zero when the total lags the rows', () => {
    expect(accumulateFromTotal([5, 5], 3)).toEqual([5, 10]);
  });

  it('starts at zero without a total', () => {
    expect(accumulateFromTotal([1, 2], undefined)).toEqual([1, 3]);
  });
});

describe('month arithmetic', () => {
  it('adds and subtracts months across year ends', () => {
    expect(addMonths('2026-09', 1)).toBe('2026-10');
    expect(addMonths('2026-09', -9)).toBe('2025-12');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 13)).toBe('2027-01');
    expect(monthsBetween('2025-09', '2026-09')).toBe(12);
    expect(monthsBetween('2026-09', '2026-09')).toBe(0);
  });

  it('maps months onto quarters', () => {
    expect(quarterKeyOf('2026-01')).toBe('2026-Q1');
    expect(quarterKeyOf('2026-03')).toBe('2026-Q1');
    expect(quarterKeyOf('2026-04')).toBe('2026-Q2');
    expect(quarterKeyOf('2026-12')).toBe('2026-Q4');
  });
});

describe('yearViewBuckets', () => {
  it('shows the last twelve months for a short history', () => {
    const buckets = yearViewBuckets(['2026-06', '2026-09'], '2026-09');
    expect(buckets.mode).toBe('month');
    expect(buckets.keys).toHaveLength(12);
    expect(buckets.keys[0]).toBe('2025-10');
    expect(buckets.keys[11]).toBe('2026-09');
    expect(buckets.keyOfMonth('2026-07')).toBe('2026-07');
  });

  it('shows the last twelve months with no history at all', () => {
    const buckets = yearViewBuckets([], '2026-09');
    expect(buckets.mode).toBe('month');
    expect(buckets.keys[11]).toBe('2026-09');
  });

  it('switches to quarters over the whole history from two years on', () => {
    // 2024-10 .. 2026-09 is 24 months: every quarter from Q4 2024.
    const buckets = yearViewBuckets(['2024-10', '2025-03'], '2026-09');
    expect(buckets.mode).toBe('quarter');
    expect(buckets.keys[0]).toBe('2024-Q4');
    expect(buckets.keys[buckets.keys.length - 1]).toBe('2026-Q3');
    expect(buckets.keys).toHaveLength(8);
    expect(buckets.keyOfMonth('2025-05')).toBe('2025-Q2');
  });

  it('stays on months one month short of two years', () => {
    expect(yearViewBuckets(['2024-11'], '2026-09').mode).toBe('month');
  });

  it('starts the quarters at the quarter of the first active month', () => {
    const buckets = yearViewBuckets(['2023-02'], '2026-09');
    expect(buckets.keys[0]).toBe('2023-Q1');
  });
});

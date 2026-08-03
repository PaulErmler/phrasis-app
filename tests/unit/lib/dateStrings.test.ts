import { describe, it, expect } from 'vitest';
import {
  addDays,
  daysBetween,
  endOfMonth,
  endOfYear,
} from '@/lib/dateStrings';

describe('dateStrings', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-08-02', 1)).toBe('2026-08-03');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-08-02', 0)).toBe('2026-08-02');
  });

  it('addDays is DST-immune (walks straight through late-March/late-October)', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('daysBetween is signed and consistent with addDays', () => {
    expect(daysBetween('2026-08-02', '2026-08-02')).toBe(0);
    expect(daysBetween('2026-08-02', '2026-08-05')).toBe(3);
    expect(daysBetween('2026-08-05', '2026-08-02')).toBe(-3);
    expect(daysBetween('2026-08-02', addDays('2026-08-02', 365))).toBe(365);
  });

  it('endOfMonth handles 30/31-day months and leap February', () => {
    expect(endOfMonth('2026-08-02')).toBe('2026-08-31');
    expect(endOfMonth('2026-09-15')).toBe('2026-09-30');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-12-31')).toBe('2026-12-31');
  });

  it('endOfYear', () => {
    expect(endOfYear('2026-08-02')).toBe('2026-12-31');
    expect(endOfYear('2026-12-31')).toBe('2026-12-31');
  });
});

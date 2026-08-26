import { describe, it, expect } from 'vitest';
import {
  addDays,
  daysBetween,
  dateInTimezone,
  endOfMonth,
  endOfYear,
  startOfDayMs,
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

  describe('startOfDayMs', () => {
    const HOUR = 3_600_000;

    it('UTC midnight is plain Date.UTC', () => {
      expect(startOfDayMs('2026-08-26', 'UTC')).toBe(
        Date.UTC(2026, 7, 26, 0, 0, 0),
      );
    });

    it('fixed-offset zones, including a non-hour offset (Kathmandu +05:45)', () => {
      // Berlin summer = UTC+2 → local midnight is 22:00 UTC the day before.
      expect(startOfDayMs('2026-08-26', 'Europe/Berlin')).toBe(
        Date.UTC(2026, 7, 25, 22, 0, 0),
      );
      expect(startOfDayMs('2026-08-26', 'Asia/Kathmandu')).toBe(
        Date.UTC(2026, 7, 25, 18, 15, 0),
      );
      // Negative offset: Los Angeles summer = UTC-7.
      expect(startOfDayMs('2026-08-26', 'America/Los_Angeles')).toBe(
        Date.UTC(2026, 7, 26, 7, 0, 0),
      );
    });

    it('the boundary maps back to its own date, one ms earlier to the previous', () => {
      for (const tz of [
        'UTC',
        'Europe/Berlin',
        'America/Los_Angeles',
        'Asia/Kathmandu',
        'America/Santiago',
        'Australia/Lord_Howe',
      ]) {
        for (const d of ['2026-03-29', '2026-08-26', '2026-10-25']) {
          const ts = startOfDayMs(d, tz);
          expect(dateInTimezone(ts, tz), `${tz} ${d}`).toBe(d);
          expect(dateInTimezone(ts - 1, tz), `${tz} ${d} -1ms`).toBe(
            addDays(d, -1),
          );
        }
      }
    });

    it('European spring-forward: 2026-03-29 is a 23-hour day', () => {
      const start = startOfDayMs('2026-03-29', 'Europe/Berlin');
      const next = startOfDayMs('2026-03-30', 'Europe/Berlin');
      expect(next - start).toBe(23 * HOUR);
    });

    it('European fall-back: 2026-10-25 is a 25-hour day', () => {
      const start = startOfDayMs('2026-10-25', 'Europe/Berlin');
      const next = startOfDayMs('2026-10-26', 'Europe/Berlin');
      expect(next - start).toBe(25 * HOUR);
    });

    it('southern-hemisphere DST (Santiago) transitions in April/September', () => {
      // Chile falls back overnight into the first Sunday of April — the
      // repeated hour lands in Saturday the 4th (25h day) — and springs
      // forward overnight into the first Sunday of September, whose missing
      // midnight hour makes Sunday the 6th the 23h day.
      const fallStart = startOfDayMs('2026-04-04', 'America/Santiago');
      const fallNext = startOfDayMs('2026-04-05', 'America/Santiago');
      expect(fallNext - fallStart).toBe(25 * HOUR);
      const springStart = startOfDayMs('2026-09-06', 'America/Santiago');
      const springNext = startOfDayMs('2026-09-07', 'America/Santiago');
      expect(springNext - springStart).toBe(23 * HOUR);
    });

    it('a gap that swallows local midnight lands on the first existing instant', () => {
      // Santiago's spring-forward jumps 00:00 → 01:00, so 2026-09-06 has no
      // local midnight at all. The boundary must still belong to that date.
      const ts = startOfDayMs('2026-09-06', 'America/Santiago');
      expect(dateInTimezone(ts, 'America/Santiago')).toBe('2026-09-06');
      expect(dateInTimezone(ts - 1, 'America/Santiago')).toBe('2026-09-05');
    });

    it('day lengths over a DST-spanning range are always 23/24/25 hours', () => {
      for (const tz of ['Europe/Berlin', 'America/Los_Angeles']) {
        let prev = startOfDayMs('2026-03-01', tz);
        for (let d = addDays('2026-03-01', 1); d <= '2026-04-15'; d = addDays(d, 1)) {
          const cur = startOfDayMs(d, tz);
          expect([23 * HOUR, 24 * HOUR, 25 * HOUR], `${tz} ${d}`).toContain(
            cur - prev,
          );
          prev = cur;
        }
      }
    });
  });
});

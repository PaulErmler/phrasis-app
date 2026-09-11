import { describe, it, expect } from 'vitest';
import {
  countdownDisplay,
  formatTimeMs,
  formatTimeMsNoDays,
} from '@/lib/formatTime';

describe('formatTimeMs', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatTimeMs(0)).toBe('0s');
    expect(formatTimeMs(999)).toBe('0s');
    expect(formatTimeMs(45_000)).toBe('45s');
    expect(formatTimeMs(59_999)).toBe('59s');
  });

  it('formats minute durations', () => {
    expect(formatTimeMs(60_000)).toBe('1m');
    expect(formatTimeMs(90_000)).toBe('1m 30s');
    expect(formatTimeMs(120_000)).toBe('2m');
  });

  it('formats hour durations', () => {
    expect(formatTimeMs(3_600_000)).toBe('1h');
    expect(formatTimeMs(3_600_000 + 60_000 * 5)).toBe('1h 5m');
  });

  it('formats day durations', () => {
    expect(formatTimeMs(86_400_000)).toBe('1d 0h');
    expect(formatTimeMs(86_400_000 + 3_600_000 * 2 + 60_000 * 30)).toBe(
      '1d 2h 30m',
    );
  });

  it('drops trailing zero minutes from day format', () => {
    // days + hours + 0 minutes → show only days + hours
    const ms = 86_400_000 + 3_600_000 * 3;
    expect(formatTimeMs(ms)).toBe('1d 3h');
  });
});

describe('formatTimeMsNoDays', () => {
  it('matches formatTimeMs below an hour, seconds and all', () => {
    for (const ms of [0, 45_000, 59_999, 60_000, 90_000, 3_599_999]) {
      expect(formatTimeMsNoDays(ms)).toBe(formatTimeMs(ms));
    }
    expect(formatTimeMsNoDays(90_000)).toBe('1m 30s');
  });

  it('drops seconds once hours are showing', () => {
    expect(formatTimeMsNoDays(3_600_000)).toBe('1h');
    expect(formatTimeMsNoDays(3_600_000 + 5 * 60_000 + 30_000)).toBe('1h 5m');
  });

  it('keeps counting hours past a day instead of rolling over', () => {
    expect(formatTimeMsNoDays(86_400_000)).toBe('24h');
    expect(formatTimeMsNoDays(86_400_000 + 4 * 3_600_000 + 12 * 60_000)).toBe(
      '28h 12m',
    );
    // A year of study still reads in hours.
    expect(formatTimeMsNoDays(365 * 86_400_000)).toBe('8760h');
  });
});

describe('countdownDisplay', () => {
  const text = (ms: number) => countdownDisplay(ms).text;
  const stale = (ms: number) => countdownDisplay(ms).staleInMs;

  it('shows seconds in the last minute', () => {
    expect(text(45_400)).toBe('45s');
    expect(text(1_000)).toBe('1s');
    expect(text(999)).toBe('0s');
    expect(text(0)).toBe('0s');
  });

  it('floors to whole units so 59m59s never reads 60m', () => {
    expect(text(59_999)).toBe('59s');
    expect(text(3_599_999)).toBe('59m');
    expect(text(86_399_999)).toBe('23h 59m');
  });

  it('shows whole minutes below an hour, dropping seconds', () => {
    // The point of not reusing formatTimeMs, which renders '14m 32s' here and
    // would force a re-render every second for a quarter-hour wait.
    expect(text(14 * 60_000 + 32_000)).toBe('14m');
    expect(text(60_000)).toBe('1m');
  });

  it('shows hours and minutes below a day', () => {
    expect(text(3_600_000)).toBe('1h');
    expect(text(14 * 3_600_000 + 23 * 60_000 + 40_000)).toBe('14h 23m');
  });

  it('shows days and hours beyond a day', () => {
    expect(text(86_400_000)).toBe('1d');
    expect(text(2 * 86_400_000 + 6 * 3_600_000 + 40 * 60_000)).toBe('2d 6h');
  });

  it('reports staleInMs as the distance just past the next text change', () => {
    // Seconds band: '45s' holds until 45_000 remain, then one ms more.
    expect(stale(45_400)).toBe(401);
    // Minute bands: '14m' holds until 14 whole minutes remain.
    expect(stale(14 * 60_000 + 32_000)).toBe(32_001);
    expect(stale(14 * 3_600_000 + 23 * 60_000 + 40_000)).toBe(40_001);
    // Day band paces by the hour, not the minute.
    expect(stale(2 * 86_400_000 + 6 * 3_600_000 + 40 * 60_000)).toBe(
      40 * 60_000 + 1,
    );
  });

  it('always clears the boundary, so waiting it out changes the text', () => {
    // Sitting exactly on a boundary is the common case, not the rare one: every
    // tick paced by `staleInMs` lands on one. Reporting the bare distance (0)
    // would re-render with identical text, forever.
    for (const ms of [1_000, 60_000, 90_000, 3_600_000, 86_400_000]) {
      expect(stale(ms)).toBeGreaterThan(0);
      expect(text(ms - stale(ms))).not.toBe(text(ms));
    }
  });

  it('crosses each band on the tick after the boundary', () => {
    expect(text(86_400_000 - stale(86_400_000))).toBe('23h 59m');
    expect(text(3_600_000 - stale(3_600_000))).toBe('59m');
    expect(text(60_000 - stale(60_000))).toBe('59s');
  });

  it('clamps negative remaining to zero rather than counting up', () => {
    expect(text(-5_000)).toBe('0s');
  });
});

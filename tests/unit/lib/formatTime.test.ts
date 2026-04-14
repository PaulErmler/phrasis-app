import { describe, it, expect } from 'vitest';
import { formatTimeMs } from '@/lib/formatTime';

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

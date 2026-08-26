import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNowMinute } from '@/hooks/use-now-minute';

const MINUTE_MS = 60_000;
// Mid-minute so quantization is visible: 10:00:30.500 → 10:00:00.000.
const BASE = new Date('2026-08-26T10:00:30.500Z').getTime();
const FLOOR = Math.floor(BASE / MINUTE_MS) * MINUTE_MS;

describe('useNowMinute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the current time quantized down to the minute', () => {
    const { result } = renderHook(() => useNowMinute());
    expect(result.current).toBe(FLOOR);
  });

  it('ticks exactly once per interval, staying quantized', () => {
    const { result } = renderHook(() => useNowMinute());

    act(() => {
      vi.advanceTimersByTime(MINUTE_MS - 1);
    });
    expect(result.current).toBe(FLOOR);

    // Interval fires at mount+60s → wall clock 10:01:30.499 → 10:01:00.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(FLOOR + MINUTE_MS);
  });

  it('freezes while paused and catches up immediately on resume', () => {
    const { result, rerender } = renderHook(
      ({ paused }: { paused: boolean }) => useNowMinute(paused),
      { initialProps: { paused: true } },
    );
    expect(result.current).toBe(FLOOR);

    act(() => {
      vi.advanceTimersByTime(5 * MINUTE_MS);
    });
    expect(result.current).toBe(FLOOR);

    // Unpausing must not wait a minute for the first tick: the consumer
    // (a kept-mounted view becoming visible) needs a fresh `now` right away.
    rerender({ paused: false });
    expect(result.current).toBe(FLOOR + 5 * MINUTE_MS);

    act(() => {
      vi.advanceTimersByTime(MINUTE_MS);
    });
    expect(result.current).toBe(FLOOR + 6 * MINUTE_MS);
  });
});

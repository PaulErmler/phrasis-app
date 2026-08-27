import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as React from 'react';
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

  it('ticks exactly at minute boundaries, not mount-relative', () => {
    const { result } = renderHook(() => useNowMinute());

    // 10:00:59.999 — the boundary hasn't passed yet.
    act(() => {
      vi.advanceTimersByTime(MINUTE_MS / 2 - 501);
    });
    expect(result.current).toBe(FLOOR);

    // 10:01:00.000 — first tick lands on the boundary (a mount-anchored
    // interval would still be showing 10:00:00 here, and until 10:01:30,
    // letting staleness reach ~120s; cards ticked due up to a minute late).
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(FLOOR + MINUTE_MS);

    // Subsequent ticks stay boundary-aligned: nothing until 10:01:59.999,
    // then 10:02:00.000 flips the value.
    act(() => {
      vi.advanceTimersByTime(MINUTE_MS - 1);
    });
    expect(result.current).toBe(FLOOR + MINUTE_MS);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(FLOOR + 2 * MINUTE_MS);
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

  it('never commits a stale value on the unpause render', () => {
    // The effect-based catch-up alone briefly COMMITS the pause-old value
    // with paused=false, subscribing time-keyed consumer queries with args
    // nothing else uses. The render-phase catch-up must discard that render
    // before it commits.
    const committed: Array<{ paused: boolean; now: number }> = [];
    const { rerender } = renderHook(
      ({ paused }: { paused: boolean }) => {
        const now = useNowMinute(paused);
        React.useEffect(() => {
          committed.push({ paused, now });
        });
        return now;
      },
      { initialProps: { paused: true } },
    );

    act(() => {
      vi.advanceTimersByTime(40 * MINUTE_MS);
    });
    const fresh = FLOOR + 40 * MINUTE_MS;
    committed.length = 0;
    rerender({ paused: false });

    const unpausedCommits = committed.filter((c) => !c.paused);
    expect(unpausedCommits.length).toBeGreaterThan(0);
    for (const commit of unpausedCommits) {
      expect(commit.now).toBe(fresh);
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useAnimatedCounter } from '@/hooks/use-animated-counter';

/**
 * The counter animates from → target once. The regression pinned here: a
 * re-run of the effect (live stats landing while home is open changes
 * `target` mid-sweep) must CONTINUE from the currently displayed value.
 * The old implementation snapped back to `from` and sat there for `delay`
 * ms, visibly resetting the daily-goal counter on every stats update.
 */
describe('useAnimatedCounter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderCounter(initial: { target: number; from?: number }) {
    return renderHook(
      ({ target, from }: { target: number; from: number }) =>
        useAnimatedCounter(target, from, 1000, 300, true, 'linear'),
      { initialProps: { target: initial.target, from: initial.from ?? 0 } },
    );
  }

  it('parks on `from`, then sweeps to the target after the delay', () => {
    const { result } = renderCounter({ target: 100 });
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(300); // delay
    });
    act(() => {
      vi.advanceTimersByTime(2000); // full sweep
    });
    expect(result.current).toBe(100);
  });

  it('continues from the displayed value when target changes mid-sweep', () => {
    const { result, rerender } = renderCounter({ target: 100 });

    act(() => {
      vi.advanceTimersByTime(300); // delay
    });
    act(() => {
      vi.advanceTimersByTime(500); // ~half the sweep
    });
    const midValue = result.current;
    expect(midValue).toBeGreaterThan(0);
    expect(midValue).toBeLessThan(100);

    // Live stats land: target moves. The counter must hold its current
    // value (no snap back to 0) and resume without the initial delay.
    rerender({ target: 200, from: 0 });
    expect(result.current).toBe(midValue);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBeGreaterThanOrEqual(midValue);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(200);
  });

  it('treats a changed `from` as a fresh animation (late-known snapshot)', () => {
    const { result, rerender } = renderCounter({ target: 100 });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // The localStorage snapshot arrives after mount: repaint at the new
    // start value and hold through the delay, exactly like a first run.
    rerender({ target: 100, from: 40 });
    expect(result.current).toBe(40);
    act(() => {
      vi.advanceTimersByTime(100); // still inside the delay window
    });
    expect(result.current).toBe(40);

    act(() => {
      vi.advanceTimersByTime(300 + 2000);
    });
    expect(result.current).toBe(100);
  });

  it('snaps straight to the target when disabled or already there', () => {
    const { result } = renderHook(() =>
      useAnimatedCounter(70, 0, 1000, 300, false),
    );
    expect(result.current).toBe(70);

    const same = renderHook(() => useAnimatedCounter(5, 5, 1000, 300, true));
    expect(same.result.current).toBe(5);
  });

  it('sweeps with the defaulted parameters (duration 1500, no delay, easeOut)', () => {
    // The explicit-args cases above always pin `linear`; this exercises the
    // default signature, including the ease-out path.
    const { result } = renderHook(() => useAnimatedCounter(100));
    expect(result.current).toBe(0);
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current).toBe(100);

    const same = renderHook(() => useAnimatedCounter(50, 50));
    expect(same.result.current).toBe(50);
  });
});

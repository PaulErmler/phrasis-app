import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

import { DailyGoalRing } from '@/components/app/stats/DailyGoalRing';

/**
 * The entrance sweep must play once per visit. Coming back from a session
 * the ring first receives the cached minute count and, a moment later, the
 * live one; that second target has to continue the running sweep, not
 * restart it from `fromMs` (which played the whole animation twice).
 */

const SIZE = 40;
const STROKE = 3.5;
const CIRCUMFERENCE = 2 * Math.PI * ((SIZE - STROKE) / 2);

/** Progress in laps read back from the arc's dash offset. */
function progressOf(container: HTMLElement): number {
  const arc = container.querySelectorAll('circle')[1]!;
  const offset = parseFloat(arc.getAttribute('stroke-dashoffset')!);
  return 1 - offset / CIRCUMFERENCE;
}

const MIN = 60_000;

describe('DailyGoalRing sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues the sweep when the target changes mid-flight instead of restarting', () => {
    const { container, rerender } = render(
      <DailyGoalRing goalMinutes={10} todayMs={5 * MIN} replayKey={1} />,
    );
    // Past the entrance delay and well into the sweep.
    act(() => {
      vi.advanceTimersByTime(300 + 600);
    });
    const midway = progressOf(container);
    expect(midway).toBeGreaterThan(0.3);
    expect(midway).toBeLessThan(0.5);

    // The live count lands: a bigger target under the same visit.
    rerender(
      <DailyGoalRing goalMinutes={10} todayMs={8 * MIN} replayKey={1} />,
    );
    act(() => {
      vi.advanceTimersByTime(50);
    });
    // No restart: the arc keeps going from where it was.
    expect(progressOf(container)).toBeGreaterThanOrEqual(midway - 1e-6);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(progressOf(container)).toBeCloseTo(0.8, 3);
  });

  it('restarts from fromMs only for a new replayKey (a new visit)', () => {
    const { container, rerender } = render(
      <DailyGoalRing goalMinutes={10} todayMs={8 * MIN} replayKey={1} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(progressOf(container)).toBeCloseTo(0.8, 3);

    rerender(
      <DailyGoalRing
        goalMinutes={10}
        todayMs={8 * MIN}
        fromMs={2 * MIN}
        replayKey={2}
      />,
    );
    // First frame of the new visit: back at the snapshot value.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(progressOf(container)).toBeCloseTo(0.2, 3);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(progressOf(container)).toBeCloseTo(0.8, 3);
  });

  it('ignores a changed fromMs under the same key', () => {
    const { container, rerender } = render(
      <DailyGoalRing goalMinutes={10} todayMs={8 * MIN} replayKey={1} />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(
      <DailyGoalRing
        goalMinutes={10}
        todayMs={8 * MIN}
        fromMs={1 * MIN}
        replayKey={1}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(progressOf(container)).toBeCloseTo(0.8, 3);
  });
});

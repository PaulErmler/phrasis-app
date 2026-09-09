import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountdown } from '@/hooks/use-countdown';
import { countdownDisplay } from '@/lib/formatTime';

const MINUTE_MS = 60_000;
const BASE = new Date('2026-09-09T10:00:00.000Z').getTime();

/**
 * Renders the hook against the real countdown formatter and records the text of
 * every commit, so a test can assert the tick CADENCE and not just the value at
 * one moment.
 */
function renderCountdown(targetMs: number | null) {
  const texts: string[] = [];
  const view = renderHook(() => {
    const value = useCountdown(targetMs, countdownDisplay);
    texts.push(value?.text ?? 'null');
    return value;
  });
  return { ...view, texts };
}

/**
 * The hook reschedules from an effect, so React has to commit between ticks for
 * the next timer to exist. One big `advanceTimersByTime` fires every timer that
 * already exists before React gets a turn, which cuts the chain after a tick or
 * two, so advance in short slices and let `act` flush between them.
 */
const advance = async (ms: number, step = 1_000) => {
  for (let left = ms; left > 0; left -= step) {
    const chunk = Math.min(step, left);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(chunk);
    });
  }
};

describe('useCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null and schedules nothing without a target', () => {
    const { result } = renderCountdown(null);
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ticks once per second in the last minute', async () => {
    const { result, texts } = renderCountdown(BASE + 5_000);
    expect(result.current?.text).toBe('5s');

    texts.length = 0;
    await advance(3_000);
    // One commit per whole second, in order. Nothing skipped, nothing repeated.
    expect(texts).toEqual(['4s', '3s', '2s']);
  });

  it('ticks once per minute for a long wait, not once per second', async () => {
    const { result, texts } = renderCountdown(BASE + 10 * MINUTE_MS);
    expect(result.current?.text).toBe('10m');

    texts.length = 0;
    await advance(5 * MINUTE_MS);
    // Five minutes of wall clock, five commits. A per-second ticker would have
    // committed 300 times here, and one that landed ON each boundary rather
    // than just past it would have committed twice a minute.
    expect(texts).toEqual(['9m', '8m', '7m', '6m', '5m']);
  });

  it('holds a minute label for exactly as long as it is accurate', async () => {
    // 90s out reads '1m' for the first 30s, then drops straight into seconds.
    const { result, texts } = renderCountdown(BASE + 90_000);
    expect(result.current?.text).toBe('1m');

    texts.length = 0;
    await advance(30_000);
    expect(result.current?.text).toBe('1m');
    expect(texts).toEqual([]);

    await advance(1);
    expect(result.current?.text).toBe('59s');

    // And from here it is per-second.
    await advance(1_000);
    expect(result.current?.text).toBe('58s');
  });

  it('stops scheduling once the target is reached', async () => {
    const { result } = renderCountdown(BASE + 2_000);
    await advance(3_000);
    expect(result.current?.text).toBe('0s');
    // No pending timer: nothing here restarts, and the screen is about to be
    // replaced by the card that just came due.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clamps rather than counting up past a target already in the past', () => {
    const { result } = renderCountdown(BASE - 30_000);
    expect(result.current?.text).toBe('0s');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recomputes when a backgrounded tab becomes visible again', () => {
    // Browsers throttle chained timeouts in hidden tabs, so the value on screen
    // can be well behind the clock by the time the user looks at it.
    const { result } = renderCountdown(BASE + 30 * MINUTE_MS);
    expect(result.current?.text).toBe('30m');

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => {
      vi.setSystemTime(BASE + 20 * MINUTE_MS);
    });
    expect(result.current?.text).toBe('30m');

    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current?.text).toBe('10m');
    hidden.mockRestore();
  });

  it('keeps ticking when consecutive ticks land the same distance from a boundary', async () => {
    // A timer that fires exactly when due leaves `remaining % 1000` at 999 on
    // every tick, so `staleInMs` is 1000 twice in a row. With the rescheduling
    // effect keyed on that value alone, React skipped the second run, nothing
    // was scheduled, and the countdown froze on "3s" (2026-09-09 review). The
    // chunked `advance` helper above never shows this because its slices land
    // on whole seconds; firing each pending timer exactly when due does.
    const { texts } = renderCountdown(BASE + 5_000);
    texts.length = 0;
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersToNextTimerAsync();
      });
    }
    expect(texts).toEqual(['4s', '3s', '2s']);
  });

  it('measures a new target against a fresh clock', () => {
    // A two-day wait ticks hourly. Fifty minutes into an hour, `now` is fifty
    // minutes old; a card that then comes due in thirty minutes must read
    // "30m", not "1h 20m" until the hourly tick catches up.
    const { result, rerender } = renderHook(
      ({ target }: { target: number }) =>
        useCountdown(target, countdownDisplay),
      { initialProps: { target: BASE + 2 * 24 * 60 * MINUTE_MS } },
    );
    expect(result.current?.text).toBe('2d');

    act(() => {
      vi.setSystemTime(BASE + 50 * MINUTE_MS);
    });
    rerender({ target: BASE + 80 * MINUTE_MS });
    expect(result.current?.text).toBe('30m');
  });

  it('retargets when the due date changes under it', async () => {
    const { result, rerender } = renderHook(
      ({ target }: { target: number }) =>
        useCountdown(target, countdownDisplay),
      { initialProps: { target: BASE + 10 * MINUTE_MS } },
    );
    expect(result.current?.text).toBe('10m');

    rerender({ target: BASE + 2 * MINUTE_MS });
    expect(result.current?.text).toBe('2m');
    await advance(MINUTE_MS);
    expect(result.current?.text).toBe('1m');
  });
});

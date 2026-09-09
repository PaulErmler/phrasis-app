import * as React from 'react';

/**
 * A ticking countdown that re-renders exactly when its display would change and
 * no more often.
 *
 * `display` reports how long its own output stays accurate (`staleInMs`), and
 * that value is what schedules the next tick, so the cadence can never drift
 * from the text it paces: per second in the last minute, per minute above that,
 * per hour for multi-day waits. See `countdownDisplay` in lib/formatTime.ts.
 *
 * Deliberately NOT built on `useNowMinute`. That hook is the single clock
 * feeding reactive Convex query args (per the no-wall-clock-in-queries
 * guideline) and must keep churning subscriptions at most once a minute. What
 * this hook produces is display state and must never reach a query.
 *
 * Returns `null` for a `null` target, and stops scheduling once the target is
 * reached; nothing here restarts on its own.
 */
export function useCountdown<T extends { staleInMs: number }>(
  targetMs: number | null,
  display: (remainingMs: number) => T,
): T | null {
  const [now, setNow] = React.useState(() => Date.now());

  // A new target is measured against a fresh clock. `now` only moves on a
  // tick, and a multi-day wait ticks hourly, so by the time the earliest due
  // card changes (a review on another device, a filter toggle) `now` can be
  // 59 minutes old and a card 30 minutes away would read "1h 29m" until the
  // next tick. Adjusting state during render is React's pattern for state
  // derived from the previous render's props.
  const [seenTarget, setSeenTarget] = React.useState(targetMs);
  if (seenTarget !== targetMs) {
    setSeenTarget(targetMs);
    setNow(Date.now());
  }

  const remaining = targetMs === null ? null : Math.max(0, targetMs - now);
  const value = remaining === null ? null : display(remaining);

  // Keyed on primitives only, so callers can pass an inline `display` lambda
  // without churning this effect every render.
  const staleInMs = value?.staleInMs ?? null;
  const done = remaining === 0;

  React.useEffect(() => {
    if (staleInMs === null || done) return;
    const timeoutId = setTimeout(() => setNow(Date.now()), staleInMs);
    return () => clearTimeout(timeoutId);
    // Recomputing from Date.now() on every fire rather than accumulating means
    // a throttled or delayed timer self-corrects instead of falling behind.
    //
    // `now` is a dependency on purpose: it is the one value that changes on
    // every tick. Keyed on `staleInMs` alone, two ticks whose timers fired
    // the same distance from a boundary (a timer that is exactly on time
    // leaves `remaining % 1000` at 999 every time, so `staleInMs` is 1000
    // twice in a row) left the deps unchanged, React skipped the effect, no
    // timeout was scheduled, and the countdown froze mid-minute.
  }, [now, staleInMs, done, targetMs]);

  React.useEffect(() => {
    if (targetMs === null) return;
    // Background tabs get chained timeouts throttled hard, so the value on
    // screen can be stale by the time the user looks at it again.
    const onVisible = () => {
      if (!document.hidden) setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [targetMs]);

  return value;
}

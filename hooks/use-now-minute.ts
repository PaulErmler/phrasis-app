import * as React from 'react';

const MINUTE_MS = 60_000;

const quantize = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;

/**
 * Current time quantized to the minute, refreshed once a minute.
 *
 * Meant as a stable `now` argument for reactive Convex queries (per the
 * no-wall-clock-in-queries guideline): the value only changes 1×/min, so the
 * query subscription isn't churned on every render, while cards still tick
 * into "due" as the user idles on the screen. Pass `paused` to freeze the
 * interval while the consumer is hidden (e.g. a kept-mounted view).
 *
 * Ticks are aligned to minute boundaries (timeout to the next boundary,
 * then a 60s interval), so the value is stale by at most 60s. A bare
 * mount-anchored interval would let staleness reach ~120s: right before a
 * tick, the stored value is the floor of the PREVIOUS tick's time.
 */
export function useNowMinute(paused = false): number {
  const [now, setNow] = React.useState(quantize);

  React.useEffect(() => {
    if (paused) return;
    // Catch up immediately on (re)activation, then tick at each boundary.
    setNow(quantize());
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(
      () => {
        setNow(quantize());
        intervalId = setInterval(() => setNow(quantize()), MINUTE_MS);
      },
      MINUTE_MS - (Date.now() % MINUTE_MS),
    );
    return () => {
      clearTimeout(timeoutId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [paused]);

  return now;
}

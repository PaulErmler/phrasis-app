/**
 * Format milliseconds as a human-readable duration string.
 * Shows seconds before minutes (e.g. "45s", "1m 30s").
 */
export function formatTimeMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  if (totalSeconds < 86400) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(totalSeconds / 86400);
  const remainder = totalSeconds % 86400;
  const hours = Math.floor(remainder / 3600);
  const minutes = Math.floor((remainder % 3600) / 60);
  return minutes > 0 ? `${days}d ${hours}h ${minutes}m` : `${days}d ${hours}h`;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type CountdownDisplay = {
  /** "45s" | "12m" | "14h 23m" | "2d 6h" */
  text: string;
  /**
   * ms until `text` is guaranteed to have changed, i.e. when the caller should
   * re-render. One ms past the boundary rather than on it: a ticker that lands
   * exactly on a boundary recomputes the same text and burns a render, and since
   * every tick lands on a boundary that would repeat forever.
   */
  staleInMs: number;
};

/**
 * A countdown label plus how long it stays accurate.
 *
 * The two travel together so a ticking caller cannot drift from the text it
 * paces: seconds in the last minute, minutes up to a day, hours beyond that.
 * `formatTimeMs` is deliberately not reused here. It renders "14m 32s" below an
 * hour, which would force a caller to re-render every second for a
 * quarter-hour wait.
 *
 * Units floor rather than round, so 59m59s reads "59m" and never "60m".
 */
export function countdownDisplay(remainingMs: number): CountdownDisplay {
  const ms = Math.max(0, remainingMs);
  // `unit` is one step of the smallest unit shown, so `ms % unit` is the drop
  // that lands on the next boundary and `+ 1` clears it.
  const stale = (unit: number) => (ms % unit) + 1;

  if (ms < MINUTE_MS) {
    return {
      text: `${Math.floor(ms / SECOND_MS)}s`,
      staleInMs: stale(SECOND_MS),
    };
  }
  if (ms < HOUR_MS) {
    return {
      text: `${Math.floor(ms / MINUTE_MS)}m`,
      staleInMs: stale(MINUTE_MS),
    };
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return {
      text: minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`,
      staleInMs: stale(MINUTE_MS),
    };
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return {
    text: hours > 0 ? `${days}d ${hours}h` : `${days}d`,
    staleInMs: stale(HOUR_MS),
  };
}

/**
 * Pure "YYYY-MM-DD" date-string arithmetic, shared between app code and
 * Convex functions (Convex can import from top-level lib/, precedent:
 * lib/constants/dailyGoal.ts). All math routes through Date.UTC on the
 * date-string components, so results are immune to the host timezone and
 * DST transitions, same style as convex/lib/dateUtils.ts getNextDay.
 */

const DAY_MS = 86_400_000;

function toUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** dateStr + n days (n may be negative). */
export function addDays(dateStr: string, n: number): string {
  return fromUtcMs(toUtcMs(dateStr) + n * DAY_MS);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

/** Last day of dateStr's month. */
export function endOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  // Day 0 of the next month = last day of this month.
  return fromUtcMs(Date.UTC(y, m, 0));
}

/** December 31st of dateStr's year. */
export function endOfYear(dateStr: string): string {
  return `${dateStr.slice(0, 4)}-12-31`;
}

/** A timestamp's calendar date in the given IANA timezone ("YYYY-MM-DD"). */
export function dateInTimezone(ms: number, timezone: string): string {
  return dateFormatterFor(timezone).format(new Date(ms));
}

/**
 * Cached `en-CA` (ISO-ordered) date formatters, keyed by IANA zone.
 *
 * Constructing an `Intl.DateTimeFormat` costs ~100µs, and the callers here are
 * hot: the homescreen re-derives "today" on every render and on a per-minute
 * tick, and the projection slot re-renders on every rotation. A process only
 * ever sees a handful of zones, so an unbounded map is fine.
 */
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
function dateFormatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = dateFormatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    dateFormatterCache.set(timezone, fmt);
  }
  return fmt;
}

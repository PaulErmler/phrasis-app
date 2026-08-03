/**
 * Pure "YYYY-MM-DD" date-string arithmetic, shared between app code and
 * Convex functions (Convex can import from top-level lib/ — precedent:
 * lib/constants/dailyGoal.ts). All math routes through Date.UTC on the
 * date-string components, so results are immune to the host timezone and
 * DST transitions — same style as convex/lib/dateUtils.ts getNextDay.
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
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(ms),
  );
}

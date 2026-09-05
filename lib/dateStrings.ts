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
 * UTC timestamp of local `hour` o'clock (default midnight) of `dateStr` in
 * `timezone`.
 *
 * DST-safe by construction rather than by offset tables: start from the UTC
 * instant of the target wall clock, measure the zone's wall clock there via
 * Intl, and shift by the difference to the desired wall clock. One repeat
 * absorbs an offset change between the guess and the target. On a
 * spring-forward gap, where the target wall clock does not exist (clocks
 * jump straight past it), returns the first existing instant after it (the
 * gap end), found by walking forward in 15-minute steps — the granularity of
 * real-world zone offsets.
 *
 * Used for bucketing due-date timestamps into user-local days (workload
 * forecast) and for the study-day rollover (lib/scheduling.ts
 * `studyDayStart`); the exact instant chosen inside a gap only shifts which
 * side of a 23-hour day a card lands on.
 */
export function startOfDayMs(
  dateStr: string,
  timezone: string,
  hour = 0,
): number {
  const desired = toUtcMs(dateStr) + hour * 3_600_000;
  let ts = desired; // UTC guess
  for (let i = 0; i < 2; i++) {
    const delta = desired - wallClockUtcMs(ts, timezone);
    if (delta === 0) break;
    ts += delta;
  }
  let steps = 0;
  while (wallClockUtcMs(ts, timezone) < desired && steps < 16) {
    ts += 15 * 60_000;
    steps++;
  }
  return ts;
}

/** The zone's wall clock at `ms`, re-encoded as a pseudo-UTC timestamp so two
 * wall clocks can be subtracted with plain arithmetic. */
function wallClockUtcMs(ms: number, timezone: string): number {
  const parts = wallClockFormatterFor(timezone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
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

/** Second per-zone cache for the wall-clock (date + h23 time) formatters used
 * by `startOfDayMs`; same cost rationale as `dateFormatterCache`. */
const wallClockFormatterCache = new Map<string, Intl.DateTimeFormat>();
function wallClockFormatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = wallClockFormatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    wallClockFormatterCache.set(timezone, fmt);
  }
  return fmt;
}

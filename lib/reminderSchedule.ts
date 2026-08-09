/**
 * Next-occurrence math for the daily reminder sweep.
 *
 * The sweep claims rows by a precomputed UTC instant (`reminderNextSendAt`),
 * which means the only timezone reasoning in the whole feature lives here:
 * given a wall-clock minute-of-day in an IANA zone, what is the next UTC
 * instant at which that clock reads that time?
 *
 * Recomputing after every send is what makes DST correct for free — the offset
 * is re-derived at the candidate instant, so a zone that shifts between today
 * and tomorrow simply yields a different UTC target. Nothing stores an offset.
 *
 * Pure and in top-level lib/ so both Convex functions and the `app` vitest
 * project can import it (precedent: lib/dateStrings.ts,
 * lib/constants/dailyGoal.ts). `Intl.DateTimeFormat` with IANA zones works in
 * the default Convex runtime — convex/lib/dateUtils.ts and
 * convex/db/stats/recordReviewStats.ts already rely on it in production.
 */

import { addDays, dateInTimezone } from './dateStrings';

/** Granularity offered by the settings time picker, in minutes. */
export const REMINDER_STEP_MINUTES = 15;

const MINUTES_PER_DAY = 1440;
const MINUTE_MS = 60_000;

/**
 * True if `minute` is a minute-of-day the picker can actually produce.
 *
 * Deliberately rejects rather than clamps, matching the house convention for
 * numeric input (see `clampDailyGoal`, which drops non-finite values instead
 * of coercing them): the picker is the only legitimate producer, so anything
 * off-step is a client bug or a hostile caller and should surface as an error
 * rather than be silently rounded into a time the user never chose.
 */
export function isValidReminderMinute(minute: number): boolean {
  return (
    Number.isInteger(minute) &&
    minute >= 0 &&
    minute < MINUTES_PER_DAY &&
    minute % REMINDER_STEP_MINUTES === 0
  );
}

/** Every minute-of-day the picker offers, ascending. */
export function reminderMinuteOptions(): number[] {
  const out: number[] = [];
  for (let m = 0; m < MINUTES_PER_DAY; m += REMINDER_STEP_MINUTES) out.push(m);
  return out;
}

/**
 * Cached formatters that expose a zone's full wall-clock for an instant.
 *
 * Same reasoning as the date-only cache in lib/dateStrings.ts: constructing an
 * `Intl.DateTimeFormat` costs ~100µs and the sweep calls this a few times per
 * due user, while a process only ever sees a handful of zones.
 */
const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Offset of `timeZone` at instant `ms`, in minutes east of UTC.
 *
 * Derived by reading the zone's wall-clock back out and re-interpreting those
 * components as UTC — the difference is the offset. Rounding to the minute
 * absorbs both the sub-second residue from dropping milliseconds and the
 * handful of historical zones with second-level offsets.
 */
function offsetMinutesAt(ms: number, timeZone: string): number {
  const parts = partsFormatterFor(timeZone).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return Math.round((asIfUtc - ms) / MINUTE_MS);
}

/**
 * The UTC instant at which `timeZone`'s clock reads `minuteLocal` on the local
 * calendar day `dateStr` ("YYYY-MM-DD").
 *
 * Two passes: guess using the offset at the naive instant, then re-derive at
 * the guess and correct. The second pass is what lands the result inside the
 * correct offset period when the naive guess falls on the wrong side of a DST
 * boundary; a third pass can never change the answer for any real-world rule,
 * because offsets are piecewise-constant over spans far longer than the
 * largest transition (an hour or two).
 *
 * Spring-forward gaps (a wall-clock time that does not exist that day) and
 * fall-back overlaps (one that happens twice) both resolve to a single nearby
 * instant rather than throwing — the same forgiving behaviour as an OS
 * calendar-repeat alarm, and the right call for a reminder.
 */
function instantForLocalMinute(
  dateStr: string,
  minuteLocal: number,
  timeZone: string,
): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Hours 0 + an overflowing minutes component: Date.UTC normalizes it, so
  // minute-of-day needs no manual /60 and %60 split.
  const naiveUtc = Date.UTC(year, month - 1, day, 0, minuteLocal);
  const firstPass = naiveUtc - offsetMinutesAt(naiveUtc, timeZone) * MINUTE_MS;
  return naiveUtc - offsetMinutesAt(firstPass, timeZone) * MINUTE_MS;
}

/**
 * The next UTC instant strictly after `fromMs` at which `timeZone`'s clock
 * reads `minuteLocal`.
 *
 * Walks local calendar days rather than adding 24h, so the result tracks the
 * user's wall clock across DST instead of drifting by an hour twice a year.
 * Three candidates is slack, not necessity: "later today" and "tomorrow" cover
 * every ordinary case, and the third absorbs a DST jump that pushes a
 * candidate back before `fromMs`.
 */
export function nextOccurrence(
  timeZone: string,
  minuteLocal: number,
  fromMs: number,
): number {
  const localToday = dateInTimezone(fromMs, timeZone);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const candidate = instantForLocalMinute(
      addDays(localToday, dayOffset),
      minuteLocal,
      timeZone,
    );
    if (candidate > fromMs) return candidate;
  }
  // Unreachable for any real zone — three local days always contain a future
  // occurrence. Fall back to a plain day's advance rather than returning
  // something in the past, which would make the sweep re-claim the row forever.
  return fromMs + MINUTES_PER_DAY * MINUTE_MS;
}

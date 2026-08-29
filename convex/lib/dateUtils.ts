/**
 * Shared date utilities for Convex backend.
 * All functions operate on "YYYY-MM-DD" date strings.
 *
 * Date arithmetic and timezone formatting delegate to lib/dateStrings so the
 * underlying implementations live in one place; the exports here are kept as
 * thin wrappers because many Convex modules import them.
 */

import { addDays, daysBetween, dateInTimezone } from '../../lib/dateStrings';

/** Compute "today" in the user's IANA timezone as a "YYYY-MM-DD" string. */
export function getTodayInTimezone(timezone: string): string {
  return dateInTimezone(Date.now(), timezone);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve "today" for a query from an optional client-supplied date string.
 *
 * Convex queries never re-run because time passed, so a query that derives
 * today from `Date.now()` keeps serving yesterday's row after local midnight
 * until an unrelated write invalidates it. Callers that need the day to roll
 * over pass a client-computed date (ticked via `useNowMinute`); it is
 * accepted only when well-formed and within ±1 day of the server's view of
 * that timezone. Anything else falls back to the server date, so a hostile
 * or skewed client can only shift its own display by a day.
 */
export function resolveClientToday(
  timezone: string,
  clientToday?: string,
): string {
  const serverToday = getTodayInTimezone(timezone);
  if (clientToday === undefined) return serverToday;
  if (!DATE_RE.test(clientToday)) return serverToday;
  // addDays(x, 0) canonicalizes ("2026-08-00" → "2026-07-31") so a
  // non-canonical-but-plausible date can't slip through as a raw map key.
  const canonical = addDays(clientToday, 0);
  // Fail CLOSED on a non-finite delta. `DATE_RE` admits out-of-range dates
  // ("9999-99-99"), which canonicalize to an ISO expanded-year string
  // ("+010007-06"); `daysBetween` then splits that into two parts and returns
  // NaN, and `NaN > 1` is false, so a bare `> 1` check would return the
  // malformed string as "today" and the first `addDays` downstream would throw
  // `RangeError: Invalid time value`, failing the whole query.
  const delta = daysBetween(serverToday, canonical);
  if (!Number.isFinite(delta) || Math.abs(delta) > 1) return serverToday;
  return canonical;
}

/**
 * Resolve the client-supplied `now` for a query (no-wall-clock query
 * guideline: pass time in as an argument so identical args keep the query
 * cacheable and results can't go stale between reruns). Optional for
 * back-compat: already-shipped bundles that omit it keep the historical
 * server-clock behavior. Fails closed to the server clock on a non-finite
 * value (Convex numbers admit NaN/Infinity, and a resolved `now` often feeds
 * Intl date formatting, which throws on those). A skewed-but-finite `now`
 * only shifts the caller's own view; harmless, same stance as
 * getFilteredCardCounts.
 */
export function resolveClientNow(clientNow: number | undefined): number {
  return clientNow !== undefined && Number.isFinite(clientNow)
    ? clientNow
    : Date.now();
}

/** True if `timezone` is an IANA zone accepted by Intl.DateTimeFormat. */
export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Determine the next day after a "YYYY-MM-DD" date string. */
export function getNextDay(dateStr: string): string {
  return addDays(dateStr, 1);
}

/** Determine the previous day before a "YYYY-MM-DD" date string. */
export function getPreviousDay(dateStr: string): string {
  return addDays(dateStr, -1);
}

/** Whole days since a "YYYY-MM-DD" date, relative to now (UTC). */
export function daysSince(dateStr: string): number {
  return daysBetween(dateStr, new Date().toISOString().slice(0, 10));
}

/** Extract month string "YYYY-MM" from a "YYYY-MM-DD" date string. */
export function getMonthString(dateStr: string): string {
  return dateStr.substring(0, 7);
}

/** Extract year string "YYYY" from a "YYYY-MM-DD" date string. */
export function getYearString(dateStr: string): string {
  return dateStr.substring(0, 4);
}

/** Convert a "YYYY-MM-DD" date string to ISO 8601 week format "YYYY-Www". */
export function getISOWeekString(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Shared date utilities for Convex backend.
 * All functions operate on "YYYY-MM-DD" date strings.
 */

/** Compute "today" in the user's IANA timezone as a "YYYY-MM-DD" string. */
export function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(),
  );
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
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Determine the previous day before a "YYYY-MM-DD" date string. */
export function getPreviousDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

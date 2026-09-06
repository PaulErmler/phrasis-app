/**
 * The running total behind the progress chart. A window (week, month, year)
 * only holds the rows inside it, but the line should read as the learner's
 * overall number: it starts at what they had before the window and ends at
 * today's total, so the tile above and the last point of the line agree.
 */

/**
 * Cumulative values for a window's increments, starting at the total from
 * before the window: `max(0, total - sum(increments))`. Without a total the
 * line starts at zero, which is what a window with no history looks like.
 */
export function accumulateFromTotal(
  increments: number[],
  total: number | undefined,
): number[] {
  const windowSum = increments.reduce((sum, v) => sum + v, 0);
  let running = total === undefined ? 0 : Math.max(0, total - windowSum);
  return increments.map((v) => {
    running += v;
    return running;
  });
}

/** How many months the year view shows when it buckets by month. */
export const YEAR_VIEW_MONTHS = 12;

/**
 * From this many months of history on, the year view shows the whole
 * history in quarters instead of the last twelve months: two years of
 * monthly points would crowd the axis, and a learner that far in wants the
 * long arc, not the last twelve months of it.
 */
export const QUARTER_VIEW_MIN_MONTHS = 24;

/** "YYYY-MM" of a "YYYY-MM-DD" day key. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/** "YYYY-Qn" of a "YYYY-MM" month key. */
export function quarterKeyOf(month: string): string {
  const m = Number(month.slice(5, 7));
  return `${month.slice(0, 4)}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** The month key `n` months after `month` (negative `n` goes back). */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}`;
}

/** Whole months from `from` to `to` (0 for the same month). */
export function monthsBetween(from: string, to: string): number {
  return (
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)))
  );
}

export type YearViewBuckets = {
  mode: 'month' | 'quarter';
  /** Bucket keys in order: "YYYY-MM" or "YYYY-Qn". */
  keys: string[];
  /** The bucket a month key falls into. */
  keyOfMonth: (month: string) => string;
};

/**
 * The buckets of the progress chart's year view. Given the months with any
 * activity, the last twelve months by month, or, once the history spans
 * `QUARTER_VIEW_MIN_MONTHS`, every quarter from the first active month to
 * the current one.
 */
export function yearViewBuckets(
  activeMonths: string[],
  currentMonth: string,
): YearViewBuckets {
  const earliest = activeMonths.reduce(
    (min, m) => (m < min ? m : min),
    currentMonth,
  );
  if (monthsBetween(earliest, currentMonth) + 1 >= QUARTER_VIEW_MIN_MONTHS) {
    const keys: string[] = [];
    const last = quarterKeyOf(currentMonth);
    let month = addMonths(earliest, -((Number(earliest.slice(5, 7)) - 1) % 3));
    for (;;) {
      const key = quarterKeyOf(month);
      keys.push(key);
      if (key === last) break;
      month = addMonths(month, 3);
    }
    return { mode: 'quarter', keys, keyOfMonth: quarterKeyOf };
  }
  const keys = Array.from({ length: YEAR_VIEW_MONTHS }, (_, i) =>
    addMonths(currentMonth, i - (YEAR_VIEW_MONTHS - 1)),
  );
  return { mode: 'month', keys, keyOfMonth: (month) => month };
}

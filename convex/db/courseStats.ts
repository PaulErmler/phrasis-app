import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { getNextDay, getPreviousDay } from '../lib/dateUtils';
export { getTodayInTimezone, getPreviousDay, getNextDay } from '../lib/dateUtils';

/**
 * Create the courseStats row for a given user + course.
 * This should be called when a new course is created.
 */
export async function createCourseStats(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
): Promise<Id<'courseStats'>> {
  return ctx.db.insert('courseStats', {
    userId,
    courseId,
    totalRepetitions: 0,
    totalTimeMs: 0,
    totalCards: 0,
    currentStreak: 0,
  });
}

/**
 * Read-only version for queries.
 */
export async function getCourseStats(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
): Promise<Doc<'courseStats'> | null> {
  return ctx.db
    .query('courseStats')
    .withIndex('by_userId_and_courseId', (q) =>
      q.eq('userId', userId).eq('courseId', courseId),
    )
    .first();
}

/**
 * Mutation-context variant of getCourseStats.
 * Convex's MutationCtx is not a subtype of QueryCtx, so we need a
 * separate function with the identical query to use inside mutations.
 */
export async function getCourseStatsForMutation(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
): Promise<Doc<'courseStats'> | null> {
  return ctx.db
    .query('courseStats')
    .withIndex('by_userId_and_courseId', (q) =>
      q.eq('userId', userId).eq('courseId', courseId),
    )
    .first();
}


export interface StreakUpdateResult {
  newStreak: number;
  newLastActivityDate: string;
  freezeConsumed: boolean;
  newFreezeCount: number;
  newFreezeUsedDate: string | undefined;
}

/**
 * Pure function: given the last activity date and today's date,
 * return the updated streak, activity date, and freeze state.
 *
 * Freeze model: every user has a single freeze slot that can cover a
 * 1-day gap. Once consumed, it regenerates after one additional day of
 * activity following the covered gap. Gaps longer than 1 day always
 * reset the streak and do not consume the freeze.
 *
 * The `streakFreezeCount` field on the document is derived (0 or 1)
 * from `streakFreezeUsedDate` plus the last activity date; the legacy
 * input value is ignored.
 */
export function computeStreakUpdate(
  lastActivityDate: string | undefined,
  todayDate: string,
  currentStreak: number,
  _streakFreezeCount?: number,
  streakFreezeUsedDate?: string,
): StreakUpdateResult {
  const isFreezeAvailable = (activityDate: string | undefined): boolean => {
    if (!streakFreezeUsedDate) return true;
    if (!activityDate) return true;
    // Freeze regenerates once the user has had an activity day strictly
    // after the day immediately following the covered gap day.
    return activityDate > getNextDay(streakFreezeUsedDate);
  };
  const availableAsCount = (activityDate: string | undefined): number =>
    isFreezeAvailable(activityDate) ? 1 : 0;

  if (!lastActivityDate) {
    return {
      newStreak: 1,
      newLastActivityDate: todayDate,
      freezeConsumed: false,
      newFreezeCount: availableAsCount(todayDate),
      newFreezeUsedDate: streakFreezeUsedDate,
    };
  }

  if (lastActivityDate === todayDate) {
    return {
      newStreak: currentStreak,
      newLastActivityDate: todayDate,
      freezeConsumed: false,
      newFreezeCount: availableAsCount(todayDate),
      newFreezeUsedDate: streakFreezeUsedDate,
    };
  }

  const expectedNextDay = getNextDay(lastActivityDate);
  if (todayDate === expectedNextDay) {
    return {
      newStreak: currentStreak + 1,
      newLastActivityDate: todayDate,
      freezeConsumed: false,
      newFreezeCount: availableAsCount(todayDate),
      newFreezeUsedDate: streakFreezeUsedDate,
    };
  }

  // Gap of exactly 1 day (skipped yesterday), consume freeze if available.
  const yesterday = getPreviousDay(todayDate);
  const dayBeforeYesterday = getPreviousDay(yesterday);
  if (
    lastActivityDate === dayBeforeYesterday &&
    isFreezeAvailable(lastActivityDate)
  ) {
    return {
      newStreak: currentStreak + 1,
      newLastActivityDate: todayDate,
      freezeConsumed: true,
      newFreezeCount: 0,
      newFreezeUsedDate: yesterday,
    };
  }

  // Longer gap. Reset streak; freeze is preserved.
  return {
    newStreak: 1,
    newLastActivityDate: todayDate,
    freezeConsumed: false,
    newFreezeCount: availableAsCount(todayDate),
    newFreezeUsedDate: streakFreezeUsedDate,
  };
}

export type StreakDisplayState =
  | 'active'
  | 'pending'
  | 'frozen'
  | 'broken'
  | 'none';

export interface StreakDisplayResult {
  /** The streak as it should be DISPLAYED today. 0 once it has lapsed. */
  displayStreak: number;
  state: StreakDisplayState;
  freezeAvailable: boolean;
}

/**
 * Pure read-time derivation of the streak as it should be displayed today,
 * without mutating the stored row.
 *
 * Streaks are only recomputed by `computeStreakUpdate` when the user does an
 * activity, so the stored `currentStreak` / `lastActivityDate` go stale between
 * activities. This re-derives the live state at read time:
 *
 *  - `active`: learned today; streak shown as-is.
 *  - `pending`: learned yesterday, not yet today; streak alive but not yet
 *                validated for today.
 *  - `frozen`: missed yesterday, but a freeze is shielding the streak (the
 *                next activity today would consume it); streak shown as-is.
 *  - `broken`: missed yesterday with no freeze, or a gap of 2+ days; the
 *                streak is dead and shows 0.
 *  - `none`: no activity ever; shows 0.
 *
 * Kept consistent with `computeStreakUpdate`: for live states the displayed
 * number equals what the next activity would leave in the document (it bumps
 * to N+1); for dead states it shows 0 and the next activity resets to 1. The
 * `freezeAvailable` expression is identical to `computeStreakUpdate`'s freeze
 * check, so the frozen-vs-broken boundary at today-2 exactly matches whether
 * the next activity would consume the freeze or reset the streak.
 */
export function deriveStreakDisplay(
  lastActivityDate: string | undefined,
  todayDate: string,
  currentStreak: number,
  streakFreezeUsedDate?: string,
): StreakDisplayResult {
  const freezeAvailable =
    !streakFreezeUsedDate ||
    (!!lastActivityDate &&
      lastActivityDate > getNextDay(streakFreezeUsedDate));

  if (!lastActivityDate) {
    return { displayStreak: 0, state: 'none', freezeAvailable };
  }
  if (lastActivityDate === todayDate) {
    return { displayStreak: currentStreak, state: 'active', freezeAvailable };
  }

  const yesterday = getPreviousDay(todayDate);
  if (lastActivityDate === yesterday) {
    return { displayStreak: currentStreak, state: 'pending', freezeAvailable };
  }

  const dayBeforeYesterday = getPreviousDay(yesterday);
  if (lastActivityDate === dayBeforeYesterday && freezeAvailable) {
    return { displayStreak: currentStreak, state: 'frozen', freezeAvailable };
  }

  // today-2 with no freeze, or a gap of 2+ days. The streak is dead.
  return { displayStreak: 0, state: 'broken', freezeAvailable };
}

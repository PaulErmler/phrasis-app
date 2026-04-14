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

  // Gap of exactly 1 day (skipped yesterday) — consume freeze if available.
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

  // Longer gap — reset streak; freeze is preserved.
  return {
    newStreak: 1,
    newLastActivityDate: todayDate,
    freezeConsumed: false,
    newFreezeCount: availableAsCount(todayDate),
    newFreezeUsedDate: streakFreezeUsedDate,
  };
}

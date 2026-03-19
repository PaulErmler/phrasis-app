import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';

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

/**
 * Compute "today" in the user's IANA timezone as a "YYYY-MM-DD" string.
 */
export function getTodayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
    new Date(),
  );
}

/**
 * Determine the next day after a "YYYY-MM-DD" date string.
 */
function getNextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getPreviousDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d - 1));
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
 */
export function computeStreakUpdate(
  lastActivityDate: string | undefined,
  todayDate: string,
  currentStreak: number,
  streakFreezeCount?: number,
  streakFreezeUsedDate?: string,
): StreakUpdateResult {
  const freezeCount = streakFreezeCount ?? 0;

  if (!lastActivityDate) {
    return {
      newStreak: 1,
      newLastActivityDate: todayDate,
      freezeConsumed: false,
      newFreezeCount: freezeCount,
      newFreezeUsedDate: streakFreezeUsedDate,
    };
  }

  if (lastActivityDate === todayDate) {
    return {
      newStreak: currentStreak,
      newLastActivityDate: todayDate,
      freezeConsumed: false,
      newFreezeCount: freezeCount,
      newFreezeUsedDate: streakFreezeUsedDate,
    };
  }

  const expectedNextDay = getNextDay(lastActivityDate);
  if (todayDate === expectedNextDay) {
    return {
      newStreak: currentStreak + 1,
      newLastActivityDate: todayDate,
      freezeConsumed: false,
      newFreezeCount: freezeCount,
      newFreezeUsedDate: streakFreezeUsedDate,
    };
  }

  // Gap of exactly 2 days (skipped yesterday) — try to use a freeze
  const yesterday = getPreviousDay(todayDate);
  const dayBeforeYesterday = getPreviousDay(yesterday);
  if (
    lastActivityDate === dayBeforeYesterday &&
    freezeCount > 0 &&
    streakFreezeUsedDate !== yesterday
  ) {
    return {
      newStreak: currentStreak + 1,
      newLastActivityDate: todayDate,
      freezeConsumed: true,
      newFreezeCount: freezeCount - 1,
      newFreezeUsedDate: yesterday,
    };
  }

  return {
    newStreak: 1,
    newLastActivityDate: todayDate,
    freezeConsumed: false,
    newFreezeCount: freezeCount,
    newFreezeUsedDate: streakFreezeUsedDate,
  };
}

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
 * Mutation-context reader used when updating stats in write paths.
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

/**
 * Pure function: given the last activity date and today's date,
 * return the updated streak and activity date.
 */
export function computeStreakUpdate(
  lastActivityDate: string | undefined,
  todayDate: string,
  currentStreak: number,
): { newStreak: number; newLastActivityDate: string } {
  if (!lastActivityDate) {
    return { newStreak: 1, newLastActivityDate: todayDate };
  }

  if (lastActivityDate === todayDate) {
    return { newStreak: currentStreak, newLastActivityDate: todayDate };
  }

  const expectedNextDay = getNextDay(lastActivityDate);
  if (todayDate === expectedNextDay) {
    return { newStreak: currentStreak + 1, newLastActivityDate: todayDate };
  }

  return { newStreak: 1, newLastActivityDate: todayDate };
}

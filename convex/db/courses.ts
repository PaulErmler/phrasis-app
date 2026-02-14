import { ConvexError } from 'convex/values';
import { QueryCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { getUserSettings, requireAuthUser } from './users';

/**
 * Get a course by its ID.
 */
export async function getCourseById(
  ctx: QueryCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'courses'> | null> {
  return ctx.db.get(courseId);
}

/**
 * Get the active course for a user (via userSettings → activeCourseId).
 * Returns null if no settings, no active course ID, or course not found.
 */
export async function getActiveCourseForUser(
  ctx: QueryCtx,
  userId: string,
): Promise<{ settings: Doc<'userSettings'>; course: Doc<'courses'> } | null> {
  const settings = await getUserSettings(ctx, userId);
  if (!settings?.activeCourseId) return null;

  const course = await ctx.db.get(settings.activeCourseId);
  if (!course) return null;

  return { settings, course };
}

/**
 * Require an authenticated user with an active course.
 * Throws if not authenticated or no active course is set.
 * Use in mutations that require both auth and an active course.
 */
export async function requireActiveCourse(ctx: QueryCtx) {
  const user = await requireAuthUser(ctx);
  const result = await getActiveCourseForUser(ctx, user._id);
  if (!result) throw new ConvexError('No active course found');
  return { user, ...result };
}

/**
 * Get all courses for a user.
 */
export async function getCoursesForUser(
  ctx: QueryCtx,
  userId: string,
): Promise<Doc<'courses'>[]> {
  return ctx.db
    .query('courses')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(50);
}

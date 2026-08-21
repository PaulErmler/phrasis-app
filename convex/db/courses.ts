import { ConvexError } from 'convex/values';
import { QueryCtx } from '../_generated/server';
import { Doc } from '../_generated/dataModel';
import { getUserSettings, requireAuthUserId } from './users';
import { FEATURE_IDS } from '../features/featureIds';

/**
 * Get the active course for a user (via userSettings → activeCourseId).
 * Returns null if no settings, no active course ID, course not found, or course is archived.
 */
export async function getActiveCourseForUser(
  ctx: QueryCtx,
  userId: string,
): Promise<{ settings: Doc<'userSettings'>; course: Doc<'courses'> } | null> {
  const settings = await getUserSettings(ctx, userId);
  if (!settings?.activeCourseId) return null;

  const course = await ctx.db.get(settings.activeCourseId);
  if (!course || course.isArchived === true) return null;

  return { settings, course };
}

/**
 * Require an authenticated user with an active course.
 * Throws if not authenticated or no active course is set.
 * Use in mutations that require both auth and an active course.
 */
export async function requireActiveCourse(ctx: QueryCtx) {
  const userId = await requireAuthUserId(ctx);
  const result = await getActiveCourseForUser(ctx, userId);
  if (!result) throw new ConvexError('No active course found');
  return { userId, ...result };
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

/**
 * Get non-archived courses for a user.
 */
export async function getActiveCourses(
  ctx: QueryCtx,
  userId: string,
): Promise<Doc<'courses'>[]> {
  const courses = await getCoursesForUser(ctx, userId);
  return courses.filter((c) => c.isArchived !== true);
}

export async function getActiveCourseCount(
  ctx: QueryCtx,
  userId: string,
): Promise<number> {
  const courses = await getActiveCourses(ctx, userId);
  return courses.length;
}

export async function getTotalCourseCount(
  ctx: QueryCtx,
  userId: string,
): Promise<number> {
  const courses = await getCoursesForUser(ctx, userId);
  return courses.length;
}

/** Courses feature row from the local usageQuotas cache (synced from Autumn). */
export type CourseQuotaSnapshot = {
  balance: number;
  included: number;
  unlimited: boolean;
};

/**
 * Read the courses quota from the local usageQuotas cache.
 * Returns null if no doc or no `courses` feature entry. Caller should treat as not synced.
 */
export async function getCourseQuotaSnapshot(
  ctx: QueryCtx,
  userId: string,
): Promise<CourseQuotaSnapshot | null> {
  const doc = await ctx.db
    .query('usageQuotas')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
  if (!doc) return null;
  const feature = doc.features[FEATURE_IDS.COURSES];
  if (!feature) return null;
  return {
    balance: feature.balance,
    included: feature.included,
    unlimited: feature.unlimited === true,
  };
}

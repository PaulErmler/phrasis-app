import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';

/**
 * Get the course settings for a given course.
 * Returns null if no settings document exists yet.
 */
export async function getCourseSettings(
  ctx: QueryCtx,
  courseId: Id<'courses'>,
): Promise<Doc<'courseSettings'> | null> {
  return ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();
}

/**
 * Get the initialReviewCount for a course, falling back to the default.
 */
export async function getInitialReviewCount(
  ctx: QueryCtx,
  courseId: Id<'courses'>,
): Promise<number> {
  const settings = await getCourseSettings(ctx, courseId);
  if (!settings) return DEFAULT_INITIAL_REVIEW_COUNT;
  return settings.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT;
}

/**
 * Create or update the course settings for a given course.
 */
export async function upsertCourseSettings(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  values: {
    initialReviewCount: number;
    activeCollectionId?: Id<'collections'>;
  },
): Promise<Id<'courseSettings'>> {
  const existing = await ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, values);
    return existing._id;
  }

  return ctx.db.insert('courseSettings', {
    courseId,
    ...values,
  });
}

/**
 * Update just the activeCollectionId on course settings.
 */
export async function setActiveCollectionOnSettings(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  activeCollectionId: Id<'collections'> | undefined,
): Promise<void> {
  const existing = await ctx.db
    .query('courseSettings')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { activeCollectionId });
  } else {
    await ctx.db.insert('courseSettings', {
      courseId,
      initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
      activeCollectionId,
    });
  }
}

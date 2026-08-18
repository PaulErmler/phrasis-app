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
 * Create or update the course settings for a given course.
 */
export async function upsertCourseSettings(
  ctx: MutationCtx,
  courseId: Id<'courses'>,
  values: {
    initialReviewCount: number;
    activeCollectionId?: Id<'collections'>;
    reviewMode?: 'audio' | 'full';
    writingInputMode?: 'translate' | 'transcribe';
    autoAddCards?: boolean;
    cardsToAddBatchSize?: number;
    dailyTimeGoalMinutes?: number;
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

  // New-course defaults, stamped explicitly on first insert only. Existing
  // courses keep resolving undefined via the legacy read-side DEFAULT_*
  // constants, so changing behavior for new users here never flips it for
  // current ones. Practice Listening starts ON, limited to a card's first
  // initial review ("Only new" = 1). "Show translation on new sentences"
  // (writing mode) also defaults on/1 — stamped for symmetry even though its
  // read-side fallback is on/1 for everyone.
  return ctx.db.insert('courseSettings', {
    courseId,
    playTargetBeforeBase: true,
    playTargetAfterBase: true,
    targetBeforeListeningStrategy: 'onlyNew',
    targetBeforeOnlyNewReps: 1,
    showTranslationOnNew: true,
    showTranslationOnlyNewReps: 1,
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

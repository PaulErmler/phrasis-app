import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import type { StatsReviewMode } from '../../types';
import { EMPTY_MODE_COUNTS } from './dailyStats';

export { getISOWeekString } from '../../lib/dateUtils';

export async function upsertWeeklyStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    week: string;
    timeMs: number;
    isNewCard: boolean;
    reviewMode?: StatsReviewMode;
    isFirstActivityToday: boolean;
  },
): Promise<{ isFirstActivityThisWeek: boolean }> {
  const existing = await ctx.db
    .query('weeklyStats')
    .withIndex('by_userId_and_courseId_and_week', (q) =>
      q.eq('userId', args.userId).eq('courseId', args.courseId).eq('week', args.week),
    )
    .first();

  if (existing) {
    // `radio`/`freeStudy` were added later and are optional in the stored
    // shape, so coalesce against an empty set before bumping a key.
    const prevMode: Record<StatsReviewMode, number> = {
      ...EMPTY_MODE_COUNTS(),
      ...(existing.reviewsByMode ?? {}),
    };
    await ctx.db.patch(existing._id, {
      totalRepetitions: existing.totalRepetitions + 1,
      totalNewCards: existing.totalNewCards + (args.isNewCard ? 1 : 0),
      totalTimeMs: existing.totalTimeMs + args.timeMs,
      activeDays: existing.activeDays + (args.isFirstActivityToday ? 1 : 0),
      ...(args.reviewMode
        ? { reviewsByMode: { ...prevMode, [args.reviewMode]: prevMode[args.reviewMode] + 1 } }
        : {}),
    });
    return { isFirstActivityThisWeek: false };
  }

  await ctx.db.insert('weeklyStats', {
    userId: args.userId,
    courseId: args.courseId,
    week: args.week,
    totalRepetitions: 1,
    totalNewCards: args.isNewCard ? 1 : 0,
    totalTimeMs: args.timeMs,
    activeDays: 1,
    ...(args.reviewMode
      ? {
        reviewsByMode: {
          ...EMPTY_MODE_COUNTS(),
          [args.reviewMode]: 1,
        },
      }
      : {}),
  });
  return { isFirstActivityThisWeek: true };
}

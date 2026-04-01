import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export { getISOWeekString } from '../../lib/dateUtils';

export async function upsertWeeklyStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    week: string;
    timeMs: number;
    isNewCard: boolean;
    reviewMode?: 'audio' | 'full';
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
    const prevMode = existing.reviewsByMode ?? { audio: 0, full: 0 };
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
      ? { reviewsByMode: { audio: args.reviewMode === 'audio' ? 1 : 0, full: args.reviewMode === 'full' ? 1 : 0 } }
      : {}),
  });
  return { isFirstActivityThisWeek: true };
}

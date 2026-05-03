import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export { getMonthString } from '../../lib/dateUtils';

export async function upsertMonthlyStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    month: string;
    timeMs: number;
    isNewCard: boolean;
    reviewMode?: 'audio' | 'full' | 'radio';
    isFirstActivityToday: boolean;
    isFirstActivityThisWeek: boolean;
  },
): Promise<{ isFirstActivityThisMonth: boolean }> {
  const existing = await ctx.db
    .query('monthlyStats')
    .withIndex('by_userId_and_courseId_and_month', (q) =>
      q.eq('userId', args.userId).eq('courseId', args.courseId).eq('month', args.month),
    )
    .first();

  if (existing) {
    const prevMode: { audio: number; full: number; radio: number } = {
      audio: 0,
      full: 0,
      radio: 0,
      ...(existing.reviewsByMode ?? {}),
    };
    await ctx.db.patch(existing._id, {
      totalRepetitions: existing.totalRepetitions + 1,
      totalNewCards: existing.totalNewCards + (args.isNewCard ? 1 : 0),
      totalTimeMs: existing.totalTimeMs + args.timeMs,
      activeDays: existing.activeDays + (args.isFirstActivityToday ? 1 : 0),
      activeWeeks: existing.activeWeeks + (args.isFirstActivityThisWeek ? 1 : 0),
      ...(args.reviewMode
        ? { reviewsByMode: { ...prevMode, [args.reviewMode]: prevMode[args.reviewMode] + 1 } }
        : {}),
    });
    return { isFirstActivityThisMonth: false };
  }

  await ctx.db.insert('monthlyStats', {
    userId: args.userId,
    courseId: args.courseId,
    month: args.month,
    totalRepetitions: 1,
    totalNewCards: args.isNewCard ? 1 : 0,
    totalTimeMs: args.timeMs,
    activeDays: 1,
    activeWeeks: 1,
    ...(args.reviewMode
      ? {
        reviewsByMode: {
          audio: args.reviewMode === 'audio' ? 1 : 0,
          full: args.reviewMode === 'full' ? 1 : 0,
          radio: args.reviewMode === 'radio' ? 1 : 0,
        },
      }
      : {}),
  });
  return { isFirstActivityThisMonth: true };
}

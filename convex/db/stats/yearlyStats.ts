import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export { getYearString } from '../../lib/dateUtils';

export async function upsertYearlyStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    year: string;
    timeMs: number;
    isNewCard: boolean;
    reviewMode?: 'audio' | 'full' | 'radio';
    isFirstActivityToday: boolean;
    isFirstActivityThisWeek: boolean;
    isFirstActivityThisMonth: boolean;
  },
): Promise<void> {
  const existing = await ctx.db
    .query('yearlyStats')
    .withIndex('by_userId_and_courseId_and_year', (q) =>
      q.eq('userId', args.userId).eq('courseId', args.courseId).eq('year', args.year),
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
      activeMonths: existing.activeMonths + (args.isFirstActivityThisMonth ? 1 : 0),
      ...(args.reviewMode
        ? { reviewsByMode: { ...prevMode, [args.reviewMode]: prevMode[args.reviewMode] + 1 } }
        : {}),
    });
    return;
  }

  await ctx.db.insert('yearlyStats', {
    userId: args.userId,
    courseId: args.courseId,
    year: args.year,
    totalRepetitions: 1,
    totalNewCards: args.isNewCard ? 1 : 0,
    totalTimeMs: args.timeMs,
    activeDays: 1,
    activeWeeks: 1,
    activeMonths: 1,
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
}

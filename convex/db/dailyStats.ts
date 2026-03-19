import { QueryCtx, MutationCtx } from '../_generated/server';
import { Id, Doc } from '../_generated/dataModel';

export async function getDailyStats(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  date: string,
): Promise<Doc<'dailyStats'> | null> {
  return ctx.db
    .query('dailyStats')
    .withIndex('by_userId_and_courseId_and_date', (q) =>
      q.eq('userId', userId).eq('courseId', courseId).eq('date', date),
    )
    .first();
}

export async function upsertDailyStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    date: string;
    timeMs: number;
    isNewCard: boolean;
  },
) {
  const existing = await ctx.db
    .query('dailyStats')
    .withIndex('by_userId_and_courseId_and_date', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('date', args.date),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      reps: existing.reps + 1,
      timeMs: existing.timeMs + args.timeMs,
      newCards: existing.newCards + (args.isNewCard ? 1 : 0),
      cardsReviewed: existing.cardsReviewed + 1,
    });
  } else {
    await ctx.db.insert('dailyStats', {
      userId: args.userId,
      courseId: args.courseId,
      date: args.date,
      reps: 1,
      timeMs: args.timeMs,
      newCards: args.isNewCard ? 1 : 0,
      cardsReviewed: 1,
    });
  }
}

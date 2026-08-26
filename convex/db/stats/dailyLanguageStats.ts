import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export async function upsertDailyLanguageStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    date: string;
    language: string;
    timeMs: number;
    isNewCard: boolean;
    newWordsCount: number;
  },
): Promise<{ newWordsCountAfter: number; previousNewWordsCount: number }> {
  const existing = await ctx.db
    .query('dailyLanguageStats')
    .withIndex('by_userId_and_courseId_and_language_and_date', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('language', args.language)
        .eq('date', args.date),
    )
    .first();

  if (existing) {
    const newWordsCountAfter = existing.newWordsCount + args.newWordsCount;
    await ctx.db.patch(existing._id, {
      reps: existing.reps + 1,
      newCards: existing.newCards + (args.isNewCard ? 1 : 0),
      timeMs: existing.timeMs + args.timeMs,
      newWordsCount: newWordsCountAfter,
    });
    return {
      newWordsCountAfter,
      previousNewWordsCount: existing.newWordsCount,
    };
  }

  await ctx.db.insert('dailyLanguageStats', {
    userId: args.userId,
    courseId: args.courseId,
    date: args.date,
    language: args.language,
    reps: 1,
    newCards: args.isNewCard ? 1 : 0,
    timeMs: args.timeMs,
    newWordsCount: args.newWordsCount,
  });
  return { newWordsCountAfter: args.newWordsCount, previousNewWordsCount: 0 };
}

import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

export async function upsertLanguageStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    language: string;
    timeMs: number;
    isNewCard: boolean;
    newWordsCount: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query('languageStats')
    .withIndex('by_userId_and_courseId_and_language', (q) =>
      q.eq('userId', args.userId).eq('courseId', args.courseId).eq('language', args.language),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      totalRepetitions: existing.totalRepetitions + 1,
      totalNewCards: existing.totalNewCards + (args.isNewCard ? 1 : 0),
      totalTimeMs: existing.totalTimeMs + args.timeMs,
      totalWords: existing.totalWords + args.newWordsCount,
    });
    return;
  }

  await ctx.db.insert('languageStats', {
    userId: args.userId,
    courseId: args.courseId,
    language: args.language,
    totalRepetitions: 1,
    totalNewCards: args.isNewCard ? 1 : 0,
    totalTimeMs: args.timeMs,
    totalWords: args.newWordsCount,
  });
}

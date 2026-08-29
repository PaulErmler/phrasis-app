import { MutationCtx, QueryCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { normalizeLanguageCode } from '../../../lib/languages';

export type LanguageWordCount = { language: string; words: number };

/** Per-language word totals for target languages only, merging variants (e.g. es + es_latam). */
export async function getTargetLanguageWordCounts(
  ctx: QueryCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    targetLanguages: readonly string[];
  },
): Promise<LanguageWordCount[]> {
  const langStatsRows = await ctx.db
    .query('languageStats')
    .withIndex('by_userId_and_courseId', (q) =>
      q.eq('userId', args.userId).eq('courseId', args.courseId),
    )
    .take(20);

  const targetSet = new Set(
    args.targetLanguages.map((l) => normalizeLanguageCode(l)),
  );
  const wordsByLang = new Map<string, number>();
  for (const r of langStatsRows) {
    if (r.totalWords <= 0) continue;
    const key = normalizeLanguageCode(r.language);
    if (!targetSet.has(key)) continue;
    wordsByLang.set(key, (wordsByLang.get(key) ?? 0) + r.totalWords);
  }

  return Array.from(wordsByLang.entries())
    .map(([language, words]) => ({ language, words }))
    .sort((a, b) => b.words - a.words);
}

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
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('language', args.language),
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

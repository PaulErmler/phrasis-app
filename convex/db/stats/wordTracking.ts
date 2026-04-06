import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

const SEGMENTER_LANGUAGES = new Set(['ja', 'zh', 'ko', 'th']);

export function tokenizeText(text: string, language: string): string[] {
  const normalized = text.toLowerCase().normalize('NFC');

  // Use Intl.Segmenter for languages without whitespace word boundaries
  // (Japanese, Chinese, Korean, Thai). This produces real words instead of
  // individual characters, which is critical for Japanese.
  if (SEGMENTER_LANGUAGES.has(language)) {
    const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
    return [...segmenter.segment(normalized)]
      .filter((seg) => seg.isWordLike)
      .map((seg) => seg.segment);
  }

  return normalized
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

export async function trackNewWords(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    languages: Array<{ language: string; text: string }>;
  },
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const { language, text } of args.languages) {
    const words = tokenizeText(text, language);
    const uniqueWords = [...new Set(words)];
    let newCount = 0;

    for (const word of uniqueWords) {
      const existing = await ctx.db
        .query('userWords')
        .withIndex('by_userId_and_courseId_and_language_and_word', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('language', language)
            .eq('word', word),
        )
        .first();

      if (!existing) {
        await ctx.db.insert('userWords', {
          userId: args.userId,
          courseId: args.courseId,
          language,
          word,
        });
        newCount++;
      }
    }

    result[language] = newCount;
  }

  return result;
}

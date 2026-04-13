import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

const SEGMENTER_LANGUAGES = new Set(['ja', 'zh', 'ko', 'th']);

export type Token = { normalized: string; original: string };

/**
 * A word is "all lowercase" if lowercasing it is a no-op. Used to decide
 * which casing variant to keep as the display form: if we've ever seen
 * the word in all-lowercase form, prefer that (covers English "the" at
 * sentence start being downgraded from "The"). Words that never appear
 * lowercase — German nouns, proper nouns — keep their capitalized form.
 */
export function isAllLowercase(s: string): boolean {
  return s === s.toLowerCase();
}

export function tokenizeText(text: string, language: string): Token[] {
  const nfc = text.normalize('NFC');

  // Use Intl.Segmenter for languages without whitespace word boundaries
  // (Japanese, Chinese, Korean, Thai). This produces real words instead of
  // individual characters, which is critical for Japanese.
  if (SEGMENTER_LANGUAGES.has(language)) {
    const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
    return [...segmenter.segment(nfc)]
      .filter((seg) => seg.isWordLike)
      .map((seg) => ({
        original: seg.segment,
        normalized: seg.segment.toLowerCase().normalize('NFC'),
      }));
  }

  return nfc
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => ({ original: w, normalized: w.toLowerCase().normalize('NFC') }));
}

const MAX_TEXTS_PER_WORD = 30;

export async function trackNewWords(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    languages: Array<{ language: string; text: string }>;
    textId?: Id<'texts'>;
  },
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const { language, text } of args.languages) {
    const tokens = tokenizeText(text, language);

    // Dedupe within this text by normalized key. If the same word appears
    // in multiple casings in a single text, prefer the all-lowercase one.
    const uniqueByNormalized = new Map<string, string>();
    for (const { normalized, original } of tokens) {
      const prev = uniqueByNormalized.get(normalized);
      if (!prev || (isAllLowercase(original) && !isAllLowercase(prev))) {
        uniqueByNormalized.set(normalized, original);
      }
    }

    let newCount = 0;

    for (const [normalized, original] of uniqueByNormalized) {
      const existing = await ctx.db
        .query('userWords')
        .withIndex('by_userId_and_courseId_and_language_and_word', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('language', language)
            .eq('word', normalized),
        )
        .first();

      if (!existing) {
        await ctx.db.insert('userWords', {
          userId: args.userId,
          courseId: args.courseId,
          language,
          word: normalized,
          displayWord: original,
        });
        newCount++;
      } else if (
        existing.displayWord === undefined ||
        (isAllLowercase(original) && !isAllLowercase(existing.displayWord))
      ) {
        // Upgrade the display form: either it was missing (pre-migration
        // row) or the new occurrence is all-lowercase and the stored one
        // isn't — per the rule "if one of them is lowercase, keep lowercase".
        await ctx.db.patch(existing._id, { displayWord: original });
      }

      // Link this word to the source text (for word → sentence lookup).
      // Runs for every word, not just new ones, since a previously-known
      // word may appear in a new text.
      if (args.textId) {
        // Check if this exact link already exists
        const existingLink = await ctx.db
          .query('userWordTexts')
          .withIndex('by_userId_courseId_language_word_textId', (q) =>
            q
              .eq('userId', args.userId)
              .eq('courseId', args.courseId)
              .eq('language', language)
              .eq('word', normalized)
              .eq('textId', args.textId!),
          )
          .first();

        if (!existingLink) {
          // Enforce per-word cap to bound storage
          const existingCount = await ctx.db
            .query('userWordTexts')
            .withIndex('by_userId_courseId_language_word', (q) =>
              q
                .eq('userId', args.userId)
                .eq('courseId', args.courseId)
                .eq('language', language)
                .eq('word', normalized),
            )
            .take(MAX_TEXTS_PER_WORD);

          if (existingCount.length < MAX_TEXTS_PER_WORD) {
            await ctx.db.insert('userWordTexts', {
              userId: args.userId,
              courseId: args.courseId,
              language,
              word: normalized,
              textId: args.textId!,
            });
          }
        }
      }
    }

    result[language] = newCount;
  }

  return result;
}

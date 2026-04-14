import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';

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
  // `es_latam` and similar underscore-separated tags aren't valid BCP-47;
  // Intl.Segmenter would throw. Normalize to hyphens.
  const bcp47 = language.replace(/_/g, '-');
  const segmenter = new Intl.Segmenter(bcp47, { granularity: 'word' });
  return [...segmenter.segment(nfc)]
    .filter((seg) => seg.isWordLike)
    .map((seg) => ({
      original: seg.segment,
      normalized: seg.segment.toLowerCase().normalize('NFC'),
    }));
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

/**
 * Update word tracking after a text is edited.
 * - Removes stale userWordTexts links for words no longer in the text
 * - Deletes userWords entries for words with no remaining sentence links
 * - Inserts userWords + userWordTexts for newly introduced words
 * - Adjusts languageStats.totalWords accordingly
 */
export async function updateWordTextsForEdit(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    textId: Id<'texts'>;
    languages: Array<{ language: string; text: string }>;
  },
): Promise<void> {
  // Build a set of (language, normalizedWord) pairs from the new text
  const currentWords = new Set<string>();
  for (const { language, text } of args.languages) {
    const tokens = tokenizeText(text, language);
    for (const { normalized } of tokens) {
      currentWords.add(`${language}\0${normalized}`);
    }
  }

  const changedLangs = new Set(args.languages.map((l) => l.language));

  // Scope by userId+courseId: dataset texts can be shared across users, so a
  // textId-only lookup would return other users' rows and the deletion loop
  // below would then delete them.
  const existingLinks = await ctx.db
    .query('userWordTexts')
    .withIndex('by_userId_courseId_textId', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('textId', args.textId),
    )
    .collect();

  // Track removed words per language for stats adjustment
  const removedWordsPerLang = new Map<string, Set<string>>();

  // Delete links for words no longer present (only for changed languages)
  for (const link of existingLinks) {
    if (!changedLangs.has(link.language)) continue;
    if (!currentWords.has(`${link.language}\0${link.word}`)) {
      await ctx.db.delete(link._id);
      if (!removedWordsPerLang.has(link.language)) removedWordsPerLang.set(link.language, new Set());
      removedWordsPerLang.get(link.language)!.add(link.word);
    }
  }

  // For each removed word, check if it has any remaining links.
  // If not, delete the userWords entry and decrement languageStats.
  for (const [language, words] of removedWordsPerLang) {
    let wordsRemoved = 0;
    for (const word of words) {
      const remaining = await ctx.db
        .query('userWordTexts')
        .withIndex('by_userId_courseId_language_word', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('language', language)
            .eq('word', word),
        )
        .first();

      if (!remaining) {
        // No sentences left — remove from userWords
        const userWord = await ctx.db
          .query('userWords')
          .withIndex('by_userId_and_courseId_and_language_and_word', (q) =>
            q
              .eq('userId', args.userId)
              .eq('courseId', args.courseId)
              .eq('language', language)
              .eq('word', word),
          )
          .first();
        if (userWord) {
          await ctx.db.delete(userWord._id);
          wordsRemoved++;
        }
      }
    }

    // Decrement languageStats.totalWords
    if (wordsRemoved > 0) {
      const langStat = await ctx.db
        .query('languageStats')
        .withIndex('by_userId_and_courseId_and_language', (q) =>
          q.eq('userId', args.userId).eq('courseId', args.courseId).eq('language', language),
        )
        .first();
      if (langStat) {
        await ctx.db.patch(langStat._id, {
          totalWords: Math.max(0, langStat.totalWords - wordsRemoved),
        });
      }
    }
  }

  // Build set of existing words that survived deletion
  const survivingWords = new Set<string>();
  for (const link of existingLinks) {
    if (changedLangs.has(link.language) && !currentWords.has(`${link.language}\0${link.word}`)) {
      continue; // was deleted
    }
    survivingWords.add(`${link.language}\0${link.word}`);
  }

  // Insert links and userWords entries for new words
  for (const { language, text } of args.languages) {
    const tokens = tokenizeText(text, language);
    // Dedupe within this text, preferring lowercase display form
    const uniqueByNormalized = new Map<string, string>();
    for (const { normalized, original } of tokens) {
      const prev = uniqueByNormalized.get(normalized);
      if (!prev || (isAllLowercase(original) && !isAllLowercase(prev))) {
        uniqueByNormalized.set(normalized, original);
      }
    }

    let wordsAdded = 0;

    for (const [normalized, original] of uniqueByNormalized) {
      if (survivingWords.has(`${language}\0${normalized}`)) continue;

      // Ensure userWords entry exists
      const existingWord = await ctx.db
        .query('userWords')
        .withIndex('by_userId_and_courseId_and_language_and_word', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('language', language)
            .eq('word', normalized),
        )
        .first();

      if (!existingWord) {
        await ctx.db.insert('userWords', {
          userId: args.userId,
          courseId: args.courseId,
          language,
          word: normalized,
          displayWord: original,
        });
        wordsAdded++;
      } else if (
        existingWord.displayWord === undefined ||
        (isAllLowercase(original) && !isAllLowercase(existingWord.displayWord))
      ) {
        await ctx.db.patch(existingWord._id, { displayWord: original });
      }

      // Insert userWordTexts link (check cap)
      const count = await ctx.db
        .query('userWordTexts')
        .withIndex('by_userId_courseId_language_word', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('language', language)
            .eq('word', normalized),
        )
        .take(MAX_TEXTS_PER_WORD);

      if (count.length < MAX_TEXTS_PER_WORD) {
        await ctx.db.insert('userWordTexts', {
          userId: args.userId,
          courseId: args.courseId,
          language,
          word: normalized,
          textId: args.textId,
        });
      }
    }

    // Increment languageStats.totalWords
    if (wordsAdded > 0) {
      const langStat = await ctx.db
        .query('languageStats')
        .withIndex('by_userId_and_courseId_and_language', (q) =>
          q.eq('userId', args.userId).eq('courseId', args.courseId).eq('language', language),
        )
        .first();
      if (langStat) {
        await ctx.db.patch(langStat._id, {
          totalWords: langStat.totalWords + wordsAdded,
        });
      }
    }
  }
}

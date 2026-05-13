import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { tokenizeText, isAllLowercase, type Token } from '../../../lib/wordTokenize';

export { tokenizeText, isAllLowercase, type Token };

const MAX_TEXTS_PER_WORD = 30;

export async function trackNewWords(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    languages: Array<{ language: string; text: string }>;
    textId?: Id<'texts'>;
    sessionId?: string;
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
          ...(args.sessionId && { sessionId: args.sessionId }),
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
      //
      // Single index read serves both the existence check and the cap check:
      // if the textId is already in the result we skip insert; otherwise we
      // only insert when length < cap.
      if (args.textId) {
        const existingLinks = await ctx.db
          .query('userWordTexts')
          .withIndex('by_userId_courseId_language_word', (q) =>
            q
              .eq('userId', args.userId)
              .eq('courseId', args.courseId)
              .eq('language', language)
              .eq('word', normalized),
          )
          .take(MAX_TEXTS_PER_WORD);

        const alreadyLinked = existingLinks.some(
          (link) => link.textId === args.textId,
        );
        if (!alreadyLinked && existingLinks.length < MAX_TEXTS_PER_WORD) {
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
  // Tokenize each incoming language once and reuse: the removal phase needs
  // the normalized set, and the insertion phase needs the original casings.
  const perLanguageTokens = new Map<string, Map<string, string>>();
  const currentWords = new Set<string>();
  for (const { language, text } of args.languages) {
    const tokens = tokenizeText(text, language);
    const uniqueByNormalized = new Map<string, string>();
    for (const { normalized, original } of tokens) {
      const prev = uniqueByNormalized.get(normalized);
      if (!prev || (isAllLowercase(original) && !isAllLowercase(prev))) {
        uniqueByNormalized.set(normalized, original);
      }
      currentWords.add(`${language}\0${normalized}`);
    }
    perLanguageTokens.set(language, uniqueByNormalized);
  }

  const changedLangs = new Set(args.languages.map((l) => l.language));
  // Accumulate net delta per language so we patch languageStats once at the
  // end instead of querying/patching it in both the removal and insert loops.
  const wordDeltaByLang = new Map<string, number>();

  // Scope by userId+courseId: dataset texts can be shared across users, so a
  // textId-only lookup would return other users' rows and the deletion loop
  // below would then delete them.
  // Bounded: a pathologically long shared text could otherwise exceed Convex's
  // collection cap. 5000 is well above any realistic card.
  const EXISTING_LINKS_CAP = 5000;
  const existingLinks = await ctx.db
    .query('userWordTexts')
    .withIndex('by_userId_courseId_textId', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('textId', args.textId),
    )
    .take(EXISTING_LINKS_CAP);
  if (existingLinks.length === EXISTING_LINKS_CAP) {
    throw new Error(
      `updateWordTextsForEdit: text ${args.textId} has ${EXISTING_LINKS_CAP}+ word links; refusing to process.`,
    );
  }

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
  // If not, delete the userWords entry and accumulate the decrement into
  // wordDeltaByLang (applied to languageStats once at the end).
  for (const [language, words] of removedWordsPerLang) {
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
          wordDeltaByLang.set(language, (wordDeltaByLang.get(language) ?? 0) - 1);
        }
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

  // Insert links and userWords entries for new words. Reuse the dedup maps
  // built at the top — avoids a second round of tokenization per language.
  for (const { language } of args.languages) {
    const uniqueByNormalized = perLanguageTokens.get(language)!;

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
        wordDeltaByLang.set(language, (wordDeltaByLang.get(language) ?? 0) + 1);
      } else if (
        existingWord.displayWord === undefined ||
        (isAllLowercase(original) && !isAllLowercase(existingWord.displayWord))
      ) {
        await ctx.db.patch(existingWord._id, { displayWord: original });
      }

      // Defensive: re-check for an exact existing link before inserting.
      // `survivingWords` is derived from the initial `existingLinks` snapshot
      // and doesn't cover writes from a concurrent mutation that may have
      // raced in (Convex OCC will retry, but only on write-set conflicts —
      // this index read guards against the read-stale-then-insert case).
      //
      // Single index read serves both the existence check and the cap check.
      const existingForWord = await ctx.db
        .query('userWordTexts')
        .withIndex('by_userId_courseId_language_word', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('language', language)
            .eq('word', normalized),
        )
        .take(MAX_TEXTS_PER_WORD);

      const alreadyLinked = existingForWord.some(
        (link) => link.textId === args.textId,
      );
      if (alreadyLinked) continue;

      if (existingForWord.length < MAX_TEXTS_PER_WORD) {
        await ctx.db.insert('userWordTexts', {
          userId: args.userId,
          courseId: args.courseId,
          language,
          word: normalized,
          textId: args.textId,
        });
      }
    }
  }

  // Apply the net languageStats delta once per language.
  // Safe under Convex's per-mutation serialization; if this function is ever
  // fanned out concurrently for the same (userId, courseId, language), this
  // read-modify-write would need to become atomic.
  for (const [language, delta] of wordDeltaByLang) {
    if (delta === 0) continue;
    const langStat = await ctx.db
      .query('languageStats')
      .withIndex('by_userId_and_courseId_and_language', (q) =>
        q.eq('userId', args.userId).eq('courseId', args.courseId).eq('language', language),
      )
      .first();
    if (langStat) {
      await ctx.db.patch(langStat._id, {
        totalWords: Math.max(0, langStat.totalWords + delta),
      });
    }
  }
}

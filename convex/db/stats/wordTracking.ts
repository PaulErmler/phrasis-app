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
  try {
    const segmenter = new Intl.Segmenter(bcp47, { granularity: 'word' });
    return [...segmenter.segment(nfc)]
      .filter((seg) => seg.isWordLike)
      .map((seg) => ({
        original: seg.segment,
        normalized: seg.segment.toLowerCase().normalize('NFC'),
      }));
  } catch {
    // Unknown/invalid BCP-47 tag — fall back to a Unicode-letter split so a
    // bad language code never crashes a deck save. Behaviour is correct for
    // Latin-script languages; imperfect but non-fatal for others.
    return [...nfc.matchAll(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)].map((m) => ({
      original: m[0],
      normalized: m[0].toLowerCase().normalize('NFC'),
    }));
  }
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

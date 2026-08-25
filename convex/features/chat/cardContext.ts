import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { pickDisplayTranslationRow } from '../../lib/contentVariants';

/**
 * Look up a card's source text, course-scoped translations, and course
 * languages via card → deck → course, returning null unless the card belongs
 * to the given user. Translations are course-scoped and ordered base-first
 * (the course-language order).
 *
 * The ONE ownership walk + sentence assembly for chat card context, shared by
 * the prompt-context path (messages.ts) and the markAlsoCorrect approval
 * (cardApprovals.ts), so what an approval stores is exactly what the tool
 * prompt saw. Lives in its own module (not messages.ts) because messages.ts
 * pulls in the agent/AI SDK stack, which approval-only importers and their
 * tests must not depend on.
 */
export async function resolveCardContext(
  ctx: MutationCtx,
  cardId: Id<'cards'>,
  userId: string,
): Promise<{
  sourceText: string;
  sourceLanguage: string;
  translations: { language: string; text: string }[];
  baseLanguages: string[];
  targetLanguages: string[];
} | null> {
  const card = await ctx.db.get(cardId);
  if (!card) return null;

  const deck = await ctx.db.get(card.deckId);
  if (!deck) return null;

  const course = await ctx.db.get(deck.courseId);
  if (!course) return null;

  if (course.userId !== userId) return null;

  const text = await ctx.db.get(card.textId);
  if (!text) return null;

  const courseLangs = new Set([...course.baseLanguages, ...course.targetLanguages]);
  courseLangs.delete(text.language);

  // One indexed read for the whole text instead of one query per course
  // language; re-ordered to the course-language order afterwards so the
  // prompt context stays stable.
  const translationRows = await ctx.db
    .query('translations')
    .withIndex('by_textId', (q) => q.eq('textId', card.textId))
    // Bounded in practice by the number of course languages (times up to
    // four gender-variant rows each); the cap is a pure backstop against an
    // unbounded read.
    .take(500);
  // One rendering per language for the prompt: group the gender-variant rows
  // and display-pick so the model never sees two Spanish lines.
  const rowsByLanguage = new Map<string, Doc<'translations'>[]>();
  for (const row of translationRows) {
    const list = rowsByLanguage.get(row.targetLanguage);
    if (list) list.push(row);
    else rowsByLanguage.set(row.targetLanguage, [row]);
  }
  const textByLanguage = new Map(
    [...rowsByLanguage.entries()].map(([lang, rows]) => [
      lang,
      pickDisplayTranslationRow(rows)!.translatedText,
    ]),
  );
  const translations = [...courseLangs]
    .filter((lang) => textByLanguage.has(lang))
    .map((lang) => ({ language: lang, text: textByLanguage.get(lang)! }));

  return {
    sourceText: text.text,
    sourceLanguage: text.language,
    translations,
    baseLanguages: course.baseLanguages,
    targetLanguages: course.targetLanguages,
  };
}

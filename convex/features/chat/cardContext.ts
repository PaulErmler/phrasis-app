import type { MutationCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { cardPinAt, servedTranslatedText } from '../../db/translationReads';

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
  courseId: Id<'courses'>;
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

  const courseLangs = new Set([
    ...course.baseLanguages,
    ...course.targetLanguages,
  ]);
  courseLangs.delete(text.language);

  // One point read per course language (single digits), in course-language
  // order so the prompt context stays stable, through the served-revision
  // accessor: the tutor must see the wording the learner's card shows, which
  // for a card pinned before a version bump is not the live row.
  const pinAt = cardPinAt(card);
  const served = await Promise.all(
    [...courseLangs].map(async (lang) => ({
      language: lang,
      text: await servedTranslatedText(ctx, {
        textId: card.textId,
        targetLanguage: lang,
        pinAt,
      }),
    })),
  );
  const translations = served.filter(
    (t): t is { language: string; text: string } => t.text !== null,
  );

  return {
    sourceText: text.text,
    sourceLanguage: text.language,
    translations,
    baseLanguages: course.baseLanguages,
    targetLanguages: course.targetLanguages,
    // The caller reads the course's writing settings from this; returning it
    // here keeps the card → deck → course walk a single traversal.
    courseId: course._id,
  };
}

import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import { assertTestHooksEnabled, requireUserIdByEmail } from '../lib/testHooks';
import { storeWritingAlternative } from './writingAlternatives';
import { liveTranslation } from '../db/translationReads';

/**
 * E2E test hooks for the writing-mode accepted-alternatives lifecycle
 * (e2e/writing-alternatives-live.spec.ts). Every function throws unless the
 * deployment has `E2E_TEST_HOOKS=1` set — enable it ONLY on dev/test
 * deployments, never in production.
 *
 * Invoked from Playwright via
 * `pnpm exec convex run features/writingAlternativesTesting:<fn> '<json>'`.
 *
 * Why a seed hook at all: in production an alternative is only ever created
 * by an LLM verdict (the grader's `alsoCorrect`, or the chat
 * `markAlsoCorrect` tool), which no spec can trigger deterministically. The
 * hook calls the SAME `storeWritingAlternative` the grader uses, so dedupe,
 * eviction, and the annotation/audio fan-out all run for real; only the
 * verdict is skipped. Downstream flows (grading against the alternative,
 * the "other accepted" list, edit-dialog CRUD, primary-edit dedupe) are
 * then driven through the browser.
 */

/**
 * Seed one accepted alternative on the card whose SOURCE text contains
 * `sourceMarker`, and pull that card to the head of the due queue
 * (`dueDate: 0`) so the next `/app/learn` serve is deterministic. Searches
 * the user's active-course decks. `alternativeId` is null when the store
 * deduped (same text as primary or an existing row).
 */
export const seedAlternative = internalMutation({
  args: {
    email: v.string(),
    sourceMarker: v.string(),
    /** Target language of the alternative (e.g. "es"). */
    language: v.string(),
    text: v.string(),
  },
  returns: v.object({
    cardId: v.id('cards'),
    alternativeId: v.union(v.id('writingAlternatives'), v.null()),
    /** The primary translation the alternative was deduped against. */
    primary: v.string(),
  }),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);

    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const courseId = settings?.activeCourseId;
    if (!courseId) throw new Error(`No active course for "${args.email}"`);

    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
      .take(5);

    for (const deck of decks) {
      const cards = await ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
        .take(500);
      for (const card of cards) {
        const text = await ctx.db.get(card.textId);
        if (!text || !text.text.includes(args.sourceMarker)) continue;
        const translation = await liveTranslation(
          ctx,
          card.textId,
          args.language,
        );
        if (!translation) {
          throw new Error(
            `Card ${card._id} has no "${args.language}" translation`,
          );
        }
        const alternativeId = await storeWritingAlternative(ctx, {
          userId,
          cardId: card._id,
          language: args.language,
          text: args.text,
          primary: translation.translatedText,
        });
        // Earliest-due wins the queue. The writing track only when it is
        // already seeded — writing an unseeded track's dueDate would make
        // the separate-mode backfill think the card was migrated.
        // preReviewCount 1 retires the first-exposure copy-typing assist
        // (`shouldShowTranslationAssist`), which would print the answer
        // above the input and bypass real grading on a fresh card.
        await ctx.db.patch(card._id, {
          dueDate: 0,
          preReviewCount: Math.max(1, card.preReviewCount),
          ...(card.writingDueDate !== undefined ? { writingDueDate: 0 } : {}),
        });
        return {
          cardId: card._id,
          alternativeId,
          primary: translation.translatedText,
        };
      }
    }
    throw new Error(
      `No card with source text containing "${args.sourceMarker}" for ` +
        `"${args.email}" (add it to the deck before seeding)`,
    );
  },
});

/**
 * The user's stored alternatives for one card — the backend truth the spec
 * asserts after UI-driven edits/deletes. Mirrors the public `listForCard`
 * query, which the hook cannot use because `convex run` has no user auth.
 */
export const listAlternatives = internalQuery({
  args: { email: v.string(), cardId: v.id('cards') },
  returns: v.array(
    v.object({
      _id: v.id('writingAlternatives'),
      language: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);
    const rows = await ctx.db
      .query('writingAlternatives')
      .withIndex('by_cardId_and_language', (q) => q.eq('cardId', args.cardId))
      .collect();
    return rows
      .filter((row) => row.userId === userId)
      .map((row) => ({ _id: row._id, language: row.language, text: row.text }));
  },
});

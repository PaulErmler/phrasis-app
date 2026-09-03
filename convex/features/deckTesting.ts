import { v } from 'convex/values';
import { internalQuery, type QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { assertTestHooksEnabled, requireUserIdByEmail } from '../lib/testHooks';

/**
 * E2E test hooks for deck-integrity invariants (e2e/deck-integrity.spec.ts
 * and the exact-delta assertions in the add-cards specs). Read-only; every
 * function throws unless the deployment has `E2E_TEST_HOOKS=1` set.
 *
 * Why these exist: presence-style e2e assertions ("a card appears") cannot
 * distinguish "worked once" from "worked fifty times", and the auto-add
 * pipeline has produced exactly that failure before — a client effect
 * looping because freshly inserted cards were invisible to the quantized
 * client clock (see createCardsFromTexts in collectionCardAdding.ts).
 * Specs use these counts to assert exact deltas and quiescence.
 */

/** Hard scan ceiling; the fixture decks stay far below it. */
const CARD_SCAN_CAP = 4000;

async function collectDeckCards(
  ctx: QueryCtx,
  email: string,
): Promise<Doc<'cards'>[]> {
  const userId = await requireUserIdByEmail(ctx, email);
  const settings = await ctx.db
    .query('userSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
  const courseId = settings?.activeCourseId;
  if (!courseId) throw new Error(`No active course for "${email}"`);
  const decks = await ctx.db
    .query('decks')
    .withIndex('by_courseId', (q) => q.eq('courseId', courseId))
    .take(5);
  const cards: Doc<'cards'>[] = [];
  for (const deck of decks) {
    cards.push(
      ...(await ctx.db
        .query('cards')
        .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
        .take(CARD_SCAN_CAP)),
    );
  }
  return cards;
}

/** Total cards across the user's active-course decks. */
export const cardCount = internalQuery({
  args: { email: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    return (await collectDeckCards(ctx, args.email)).length;
  },
});

/**
 * Number of texts represented by MORE than one card in the user's
 * active-course decks. The core duplicate-add invariant: every add path
 * (manual, import, collection add, learn-mode auto-add, concurrent tabs)
 * must keep this at zero.
 */
export const duplicateTextCount = internalQuery({
  args: { email: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const cards = await collectDeckCards(ctx, args.email);
    const seen = new Map<string, number>();
    for (const card of cards) {
      seen.set(card.textId, (seen.get(card.textId) ?? 0) + 1);
    }
    let duplicates = 0;
    for (const count of seen.values()) {
      if (count > 1) duplicates++;
    }
    return duplicates;
  },
});

/**
 * Cards in the user's active-course decks, split by where they came from.
 *
 * The subject of the source-mixing e2e (`e2e/auto-add-sources.spec.ts`).
 * "Half the batch came from each source" is a proportion, and proportions
 * are exactly what a presence-style assertion ("a card appeared") cannot
 * see: the old behaviour — drain every custom text first, then start on the
 * course — passes every such check while producing a batch that is 100%
 * custom.
 *
 * `collectionId` is stamped on the card at insert, so the split is read off
 * the cards themselves rather than reconstructed from progress counters.
 * A card whose collection is gone counts as neither.
 */
export const cardCountsBySource = internalQuery({
  args: { email: v.string() },
  returns: v.object({
    premade: v.number(),
    custom: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const cards = await collectDeckCards(ctx, args.email);
    const originByCollection = new Map<string, string | undefined>();
    let premade = 0;
    let custom = 0;
    for (const card of cards) {
      const key = card.collectionId?.toString();
      if (!key) continue;
      if (!originByCollection.has(key)) {
        const coll = await ctx.db.get(card.collectionId!);
        originByCollection.set(key, coll?.origin);
      }
      const origin = originByCollection.get(key);
      if (origin === 'premade') premade++;
      else if (origin === 'custom' || origin === 'chat') custom++;
    }
    return { premade, custom, total: cards.length };
  },
});

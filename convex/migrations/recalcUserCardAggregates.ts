import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import {
  cardsByState,
  cardsByDueDate,
  cardsByStateAndDueDate,
  clearAggregatesForDeck,
} from '../db/stats/cardAggregates';

const BATCH_SIZE = 100;

/**
 * Entry point: rebuild all three card aggregates for every card under every
 * deck the given user owns. Clears the affected namespaces first, then walks
 * each deck's cards in batches via the scheduler.
 *
 * Run from the dashboard:
 *   migrations/recalcUserCardAggregates:run { userId: "..." }
 */
export const run = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const courses = await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .collect();

    const deckIds: Id<'decks'>[] = [];
    for (const course of courses) {
      const decks = await ctx.db
        .query('decks')
        .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
        .collect();
      for (const deck of decks) deckIds.push(deck._id);
    }

    for (const deckId of deckIds) {
      await clearAggregatesForDeck(ctx, deckId);
    }

    if (deckIds.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recalcUserCardAggregates.processBatch,
        { deckIds, deckIdx: 0 },
      );
    }

    return { status: 'started', deckCount: deckIds.length };
  },
});

/**
 * Process one batch of cards from the current deck, then either continue
 * paginating that deck or advance to the next deck.
 */
export const processBatch = internalMutation({
  args: {
    deckIds: v.array(v.id('decks')),
    deckIdx: v.number(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.deckIdx >= args.deckIds.length) {
      return { processed: 0, isDone: true };
    }
    const deckId = args.deckIds[args.deckIdx];

    const result = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    for (const doc of result.page) {
      await cardsByState.insertIfDoesNotExist(ctx, doc);
      await cardsByDueDate.insertIfDoesNotExist(ctx, doc);
      await cardsByStateAndDueDate.insertIfDoesNotExist(ctx, doc);
    }

    const advanceDeck = result.isDone;
    const nextDeckIdx = advanceDeck ? args.deckIdx + 1 : args.deckIdx;
    if (nextDeckIdx < args.deckIds.length) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recalcUserCardAggregates.processBatch,
        advanceDeck
          ? { deckIds: args.deckIds, deckIdx: nextDeckIdx }
          : {
            deckIds: args.deckIds,
            deckIdx: nextDeckIdx,
            cursor: result.continueCursor,
          },
      );
    }

    return {
      processed: result.page.length,
      isDone: advanceDeck && nextDeckIdx >= args.deckIds.length,
    };
  },
});

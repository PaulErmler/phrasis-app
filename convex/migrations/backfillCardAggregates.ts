import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  cardsByState,
  cardsByDueDate,
  cardsByStateAndDueDate,
  clearAggregatesForDeck,
} from '../db/stats/cardAggregates';

const BATCH_SIZE = 100;

/**
 * Entry point: run from dashboard with no parameters.
 * Kicks off a batched backfill of card aggregates for all existing cards.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillCardAggregates.processBatch,
      {},
    );
    return { status: 'started' };
  },
});

/**
 * Process one batch of cards, then schedule the next batch.
 */
export const processBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query('cards').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    for (const doc of result.page) {
      await cardsByState.insertIfDoesNotExist(ctx, doc);
      await cardsByDueDate.insertIfDoesNotExist(ctx, doc);
      await cardsByStateAndDueDate.insertIfDoesNotExist(ctx, doc);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillCardAggregates.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      isDone: result.isDone,
    };
  },
});

/**
 * Clear all card aggregates for a specific deck (use before re-running backfill).
 */
export const clearForDeck = internalMutation({
  args: { deckId: v.id('decks') },
  handler: async (ctx, args) => {
    await clearAggregatesForDeck(ctx, args.deckId);
  },
});

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import {
  cardsByState,
  cardsByDueDate,
  cardsByStateAndDueDate,
  cardsByOriginStateAndDueDate,
  clearAggregatesForDeck,
} from '../db/stats/cardAggregates';

const BATCH_SIZE = 100;

/**
 * Entry point: rebuild all four card aggregates for every card under every
 * deck the given user owns. Only enumerates the decks here — clearing and
 * re-inserting happens one deck per scheduled mutation, because a single
 * deck's clear is 32 aggregate namespace calls (states × origin buckets) and
 * doing every deck in one transaction can blow the mutation limits and fail
 * half-cleared.
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
 * Self-continuing worker. For each deck: first invocation (no `cleared`
 * flag) only clears that deck's aggregate namespaces and reschedules;
 * subsequent invocations page through the deck's cards and re-insert, then
 * advance to the next deck (which starts with its own clear-only step).
 */
export const processBatch = internalMutation({
  args: {
    deckIds: v.array(v.id('decks')),
    deckIdx: v.number(),
    cursor: v.optional(v.string()),
    cleared: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.deckIdx >= args.deckIds.length) {
      return { processed: 0, isDone: true };
    }
    const deckId = args.deckIds[args.deckIdx];

    if (!args.cleared) {
      await clearAggregatesForDeck(ctx, deckId);
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recalcUserCardAggregates.processBatch,
        { deckIds: args.deckIds, deckIdx: args.deckIdx, cleared: true },
      );
      return { processed: 0, isDone: false };
    }

    const result = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
      .paginate({ cursor: args.cursor ?? null, numItems: BATCH_SIZE });

    for (const doc of result.page) {
      await cardsByState.insertIfDoesNotExist(ctx, doc);
      await cardsByDueDate.insertIfDoesNotExist(ctx, doc);
      await cardsByStateAndDueDate.insertIfDoesNotExist(ctx, doc);
      await cardsByOriginStateAndDueDate.insertIfDoesNotExist(ctx, doc);
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
            cleared: true,
          },
      );
    }

    return {
      processed: result.page.length,
      isDone: advanceDeck && nextDeckIdx >= args.deckIds.length,
    };
  },
});

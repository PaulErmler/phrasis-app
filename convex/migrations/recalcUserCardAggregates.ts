import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import {
  cardsByState,
  cardsByDueDate,
  cardsByStateAndDueDate,
  cardsByOriginStateAndDueDate,
  cardsByWritingStateAndDueDate,
  cardsByOriginWritingStateAndDueDate,
  hasWritingTrack,
  clearAggregatesForDeck,
} from '../db/stats/cardAggregates';

// 100 cards x 4 aggregate inserts was the old ceiling; the writing-track
// mirrors take a split-course deck to 6 per card, so the batch is trimmed to
// keep the per-mutation write count in the same band.
const BATCH_SIZE = 75;

/**
 * Entry point: rebuild all card aggregates for every card under every
 * deck the given user owns. Only enumerates the decks here, clearing and
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
 * Self-continuing worker. For each deck the clear runs as TWO scheduled
 * steps. Shared-track namespaces, then writing-track, before paging through
 * the deck's cards to re-insert, then advancing to the next deck (which starts
 * with its own clear steps).
 *
 * The clear is split because doing both tracks at once is 62 component
 * subtransactions in one mutation, double the 32 this one-deck-per-mutation
 * design was sized for (see `run` above). Blowing the limit mid-clear would
 * leave a deck's aggregates half-wiped with no re-insert pass, so every due
 * count for it reads low until the migration is run again by hand.
 *
 * `clearPhase` is absent on the first invocation, 'writing' on the second, and
 * 'done' once the deck is ready for re-inserts.
 */
export const processBatch = internalMutation({
  args: {
    deckIds: v.array(v.id('decks')),
    deckIdx: v.number(),
    cursor: v.optional(v.string()),
    clearPhase: v.optional(v.union(v.literal('writing'), v.literal('done'))),
  },
  handler: async (ctx, args) => {
    if (args.deckIdx >= args.deckIds.length) {
      return { processed: 0, isDone: true };
    }
    const deckId = args.deckIds[args.deckIdx];

    if (args.clearPhase !== 'done') {
      const track = args.clearPhase === 'writing' ? 'writing' : 'shared';
      await clearAggregatesForDeck(ctx, deckId, track);
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recalcUserCardAggregates.processBatch,
        {
          deckIds: args.deckIds,
          deckIdx: args.deckIdx,
          clearPhase:
            track === 'shared' ? ('writing' as const) : ('done' as const),
        },
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
      if (hasWritingTrack(doc)) {
        await cardsByWritingStateAndDueDate.insertIfDoesNotExist(ctx, doc);
        await cardsByOriginWritingStateAndDueDate.insertIfDoesNotExist(ctx, doc);
      }
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
            clearPhase: 'done' as const,
          },
      );
    }

    return {
      processed: result.page.length,
      isDone: advanceDeck && nextDeckIdx >= args.deckIds.length,
    };
  },
});

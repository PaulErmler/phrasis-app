import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { cardsByStateAndDueDate } from '../db/stats/cardAggregates';

const BATCH_SIZE = 100;

/**
 * Entry point: run from dashboard with no parameters.
 * Backfills the `isGraduated` field on all existing cards.
 *
 * isGraduated = false when:
 *   - schedulingPhase === 'preReview'
 *   - schedulingPhase === 'review' AND fsrsState.state is 0 (New) or 1 (Learning)
 *
 * isGraduated = true when:
 *   - schedulingPhase === 'review' AND fsrsState.state >= 2 (Review or Relearning)
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillIsGraduated.processBatch,
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

    let updated = 0;
    for (const doc of result.page) {
      // Backfill isGraduated
      if (doc.isGraduated === undefined) {
        const isGraduated =
          doc.schedulingPhase === 'review' &&
          doc.fsrsState != null &&
          doc.fsrsState.state >= 2;

        await ctx.db.patch(doc._id, { isGraduated });
        updated++;
      }

      // Backfill cardsByStateAndDueDate aggregate
      await cardsByStateAndDueDate.insertIfDoesNotExist(ctx, doc);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillIsGraduated.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      updated,
      isDone: result.isDone,
    };
  },
});

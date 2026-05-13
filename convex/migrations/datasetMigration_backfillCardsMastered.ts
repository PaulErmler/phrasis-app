import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';

const BATCH_SIZE = 25;

/**
 * One-time backfill: populate `collectionProgress.cardsMastered` for every
 * existing row that doesn't have it set. The count is derived from the
 * source-of-truth `cards` table at backfill time. Going forward the field
 * is maintained monotonically by `patchCard` in db/stats/cardAggregates.ts.
 *
 * Iteration walks `decks` rather than `collectionProgress` so each deck's
 * mastered-cards set is scanned exactly once and tallied per collection in
 * memory, then applied to all of that course's `collectionProgress` rows.
 *
 * Idempotent: rows whose `cardsMastered` is already defined are skipped.
 * Safe to re-run.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
      {},
    );
    return { status: 'started' };
  },
});

export const processBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query('decks').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    let updated = 0;
    let skipped = 0;
    for (const deck of result.page) {
      const course = await ctx.db.get(deck.courseId);
      if (!course) continue;
      const progressRows = await ctx.db
        .query('collectionProgress')
        .withIndex('by_userId_and_courseId', (q) =>
          q.eq('userId', course.userId).eq('courseId', deck.courseId),
        )
        .collect();
      const pending = progressRows.filter((p) => p.cardsMastered === undefined);
      if (pending.length === 0) {
        skipped += progressRows.length;
        continue;
      }

      const masteredCards = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_isHidden_and_isMastered', (q) =>
          q.eq('deckId', deck._id).eq('isHidden', false).eq('isMastered', true),
        )
        .collect();

      const countByCollection = new Map<string, number>();
      for (const card of masteredCards) {
        if (!card.collectionId) continue;
        const key = card.collectionId as string;
        countByCollection.set(key, (countByCollection.get(key) ?? 0) + 1);
      }

      for (const progress of pending) {
        const count = countByCollection.get(progress.collectionId as string) ?? 0;
        await ctx.db.patch(progress._id, { cardsMastered: count });
        updated++;
      }
      skipped += progressRows.length - pending.length;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.datasetMigration_backfillCardsMastered.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return {
      processedDecks: result.page.length,
      updated,
      skipped,
      isDone: result.isDone,
    };
  },
});

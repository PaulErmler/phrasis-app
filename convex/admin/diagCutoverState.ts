import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';

/**
 * One-shot diagnostic — reports whether the OGTE cutover has been applied
 * locally. Counts courses, courses with `reconciledDatasetId` set, and
 * collectionProgress rows on the new dataset's collections.
 *
 * Safe to delete after verifying.
 */
export const diagCutoverState = internalQuery({
  args: { datasetId: v.id('datasets') },
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) return { error: 'dataset-not-found' };

    const courses = await ctx.db.query('courses').collect();
    const settingsRows = await ctx.db.query('courseSettings').collect();
    const reconciled = settingsRows.filter(
      (s) => s.reconciledDatasetId === args.datasetId,
    );

    const newCollections = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) => q.eq('datasetId', args.datasetId))
      .collect();
    const newCollectionIds = new Set(newCollections.map((c) => c._id));

    const progressRows = await ctx.db.query('collectionProgress').collect();
    const progressOnNew = progressRows.filter((p) =>
      newCollectionIds.has(p.collectionId),
    );
    const progressOnNewWithCounts = progressOnNew.filter(
      (p) => p.cardsAdded > 0 || (p.cardsLearned ?? 0) > 0 || (p.cardsMastered ?? 0) > 0,
    );

    return {
      dataset: {
        id: dataset._id,
        slug: dataset.slug,
        version: dataset.version,
        isActive: dataset.isActive,
      },
      courses: courses.length,
      courseSettings: settingsRows.length,
      reconciledToThisDataset: reconciled.length,
      newCollectionCount: newCollections.length,
      collectionProgressRowsOnNewDataset: progressOnNew.length,
      collectionProgressRowsWithNonZeroCounters: progressOnNewWithCounts.length,
      sampleRolledForward: progressOnNewWithCounts.slice(0, 5).map((p) => ({
        collectionId: p.collectionId,
        cardsAdded: p.cardsAdded,
        cardsLearned: p.cardsLearned,
        cardsMastered: p.cardsMastered,
      })),
    };
  },
});

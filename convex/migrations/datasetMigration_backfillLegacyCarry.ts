import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { LEGACY_TO_NEW_CODE } from '../lib/collections';

/**
 * One-shot backfill of `collectionProgress.legacyCarryAdded` for users who
 * were cut over BEFORE the field existed. The original cutover added legacy
 * `cardsAdded` into the destination row's `cardsAdded` but didn't preserve
 * the rolled-forward amount separately — so the home view couldn't widen the
 * denominator to match the inflated numerator (resulting in displays like
 * `100/300` where the 100 wasn't really progress against L02's actual texts).
 *
 * This migration re-derives `legacyCarryAdded` for each already-cutover user
 * by reading the user's legacy CEFR `collectionProgress` rows directly. The
 * legacy rows are never decremented (monotonic per schema.ts), so their
 * `cardsAdded` snapshot at the moment of cutover is still recoverable.
 *
 * Idempotent: overwrites `legacyCarryAdded` with the legacy snapshot value on
 * each run, rather than accumulating. Safe to re-run.
 *
 * Trigger from the Convex dashboard:
 *   `internal/migrations/datasetMigration_backfillLegacyCarry:backfillAllUsers`
 */

const COURSE_PAGE_SIZE = 25;
const SCHEDULE_STAGGER_MS = 50;

export const backfillAllUsers = internalMutation({
  args: {
    datasetId: v.id('datasets'),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    processed: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db.query('courses').paginate({
      cursor: args.cursor ?? null,
      numItems: COURSE_PAGE_SIZE,
    });

    let stagger = 0;
    for (const course of result.page) {
      if (course.isArchived) continue;
      await ctx.scheduler.runAfter(
        stagger,
        internal.migrations.datasetMigration_backfillLegacyCarry.backfillUser,
        {
          userId: course.userId,
          courseId: course._id,
          datasetId: args.datasetId,
        },
      );
      stagger += SCHEDULE_STAGGER_MS;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.datasetMigration_backfillLegacyCarry.backfillAllUsers,
        { datasetId: args.datasetId, cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      isDone: result.isDone,
    };
  },
});

export const backfillUser = internalMutation({
  args: {
    userId: v.string(),
    courseId: v.id('courses'),
    datasetId: v.id('datasets'),
  },
  returns: v.object({
    skipped: v.boolean(),
    reason: v.optional(v.string()),
    patched: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    // Only target users who have already been cut over to this dataset.
    // Pre-cutover users will get `legacyCarryAdded` set by `cutoverUser`
    // itself when their cutover runs.
    const settings = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .first();
    if (settings?.reconciledDatasetId !== args.datasetId) {
      return { skipped: true, reason: 'not-reconciled' };
    }

    // Resolve new collection ids by code, scoped to the active dataset.
    const newCollections = await ctx.db
      .query('collections')
      .withIndex('by_datasetId_and_order', (q) =>
        q.eq('datasetId', args.datasetId),
      )
      .collect();
    const newCodeToId = new Map<string, Id<'collections'>>();
    for (const c of newCollections) {
      if (c.code) newCodeToId.set(c.code, c._id);
    }

    // Resolve the seven legacy CEFR collection docs by name.
    const legacyNames = Object.keys(LEGACY_TO_NEW_CODE);
    const legacyDocs = await Promise.all(
      legacyNames.map((name) =>
        ctx.db
          .query('collections')
          .withIndex('by_name', (q) => q.eq('name', name))
          .first(),
      ),
    );
    const legacyByName = new Map<string, Doc<'collections'>>();
    legacyNames.forEach((name, i) => {
      const doc = legacyDocs[i];
      if (doc) legacyByName.set(name, doc);
    });

    let patched = 0;
    for (const legacyName of legacyNames) {
      const targetCode = LEGACY_TO_NEW_CODE[legacyName];
      const targetId = newCodeToId.get(targetCode);
      if (!targetId) continue;

      const legacyCollection = legacyByName.get(legacyName);
      if (!legacyCollection) continue;
      if (legacyCollection._id === targetId) continue;

      const legacyProgress = await ctx.db
        .query('collectionProgress')
        .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('collectionId', legacyCollection._id),
        )
        .first();
      if (!legacyProgress) continue;

      const legacyAdded = legacyProgress.cardsAdded ?? 0;
      if (legacyAdded === 0) continue;

      const destProgress = await ctx.db
        .query('collectionProgress')
        .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
          q
            .eq('userId', args.userId)
            .eq('courseId', args.courseId)
            .eq('collectionId', targetId),
        )
        .first();
      if (!destProgress) continue;

      // Overwrite, don't accumulate — the legacy `cardsAdded` snapshot IS
      // the carry-forward amount, and we want re-runs to be idempotent.
      if (destProgress.legacyCarryAdded === legacyAdded) continue;
      await ctx.db.patch(destProgress._id, { legacyCarryAdded: legacyAdded });
      patched++;
    }

    return { skipped: false, patched };
  },
});

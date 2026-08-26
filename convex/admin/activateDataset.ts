import { v, ConvexError } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { optionalEnv } from '../lib/env';

/**
 * Activate a dataset. Flips its `isActive` to true and deactivates any other
 * dataset currently marked active (only one can be active globally). Optionally
 * schedules the per-user cutover (which rolls legacy CEFR-collection progress
 * forward into the new dataset's first-of-tier levels).
 *
 * Gated by the FF_NEW_COURSE_CUTOVER env var when `runCutover: true` is
 * passed, if the flag is missing/unset, activation still happens but the
 * cutover fan-out is skipped (the admin can invoke it later).
 *
 * Idempotent: re-running with the same datasetId is safe.
 */
export const activateDataset = internalMutation({
  args: {
    datasetId: v.id('datasets'),
    runCutover: v.optional(v.boolean()),
  },
  returns: v.object({
    datasetId: v.id('datasets'),
    cutoverScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) throw new ConvexError(`Dataset ${args.datasetId} not found`);

    // Deactivate any other active dataset globally. By contract at most one
    // should exist; we still iterate defensively in case of stale state. If
    // the user re-activates the already-active dataset, we skip the patch.
    const otherActive = await ctx.db
      .query('datasets')
      .withIndex('by_isActive', (q) => q.eq('isActive', true))
      .collect();
    for (const other of otherActive) {
      if (other._id !== dataset._id) {
        await ctx.db.patch(other._id, { isActive: false });
      }
    }

    if (!dataset.isActive) {
      await ctx.db.patch(dataset._id, { isActive: true });
    }

    // Optional: schedule the per-user cutover fan-out. Gated by env var so
    // production activation can land first and the cutover can be triggered
    // separately during a low-traffic window.
    let cutoverScheduled = false;
    const cutoverFlag = (optionalEnv('FF_NEW_COURSE_CUTOVER') ?? '').toLowerCase();
    const flagEnabled = cutoverFlag === '1' || cutoverFlag === 'true';
    if (args.runCutover && flagEnabled) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.datasetMigration_cutoverUser.cutoverAllUsers,
        { datasetId: dataset._id },
      );
      cutoverScheduled = true;
    }

    return { datasetId: dataset._id, cutoverScheduled };
  },
});

/**
 * Bare cutover trigger. Call this directly from the dashboard to run the
 * per-user cutover after `activateDataset` has been called. Useful when you
 * want to flip `isActive` first (silent) and only later kick off the
 * progress roll-forward.
 *
 * Still gated by FF_NEW_COURSE_CUTOVER so accidental dashboard calls don't
 * fan out across the user base.
 */
export const runCutoverNow = internalMutation({
  args: {
    datasetId: v.id('datasets'),
  },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) throw new ConvexError(`Dataset ${args.datasetId} not found`);

    const cutoverFlag = (optionalEnv('FF_NEW_COURSE_CUTOVER') ?? '').toLowerCase();
    const flagEnabled = cutoverFlag === '1' || cutoverFlag === 'true';
    if (!flagEnabled) {
      throw new ConvexError(
        'FF_NEW_COURSE_CUTOVER is not enabled. Set it to "true" before running cutover.',
      );
    }

    await ctx.scheduler.runAfter(
      0,
      internal.migrations.datasetMigration_cutoverUser.cutoverAllUsers,
      { datasetId: dataset._id },
    );
    return { scheduled: true };
  },
});

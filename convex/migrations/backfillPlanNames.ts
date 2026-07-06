"use node";

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { components, internal } from '../_generated/api';
import { syncQuotasForUser } from '../usage/tracking';

// Small batches: each user costs one Autumn API round-trip, and the batch
// self-continues, so this bounds both action runtime and API burst rate.
const BATCH_SIZE = 25;

/**
 * One-time backfill: re-sync every user's quotas from Autumn so the new
 * planId/planName/planStatus fields (captured by derivePlan during sync)
 * get written to `usageQuotas`. Pages over Better Auth users rather than
 * usageQuotas so users without a quota doc get one created too
 * (getOrCreateCustomer attaches the auto-enable free plan).
 *
 * Requires the plan-capture changes in usage/tracking.ts to be deployed
 * first. Kick off from the Convex dashboard / CLI:
 * `npx convex run migrations/backfillPlanNames:run`
 */
export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillPlanNames.processBatch,
      {},
    );
    return { status: 'started' };
  },
});

export const processBatch = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result: {
      page: Array<{ _id: string }>;
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: args.cursor ?? null, numItems: BATCH_SIZE },
    });

    for (const user of result.page) {
      await syncQuotasForUser(ctx, user._id);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillPlanNames.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return { processed: result.page.length, isDone: result.isDone };
  },
});

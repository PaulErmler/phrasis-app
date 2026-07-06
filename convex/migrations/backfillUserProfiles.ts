import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { components, internal } from '../_generated/api';
import { upsertUserProfile, type AuthUserDoc } from '../db/userProfiles';

const BATCH_SIZE = 200;

/**
 * One-time backfill: mirror every existing Better Auth user into the
 * app-owned `userProfiles` table (new/updated users are handled live by
 * the user triggers in convex/auth.ts).
 *
 * Idempotent — upsertUserProfile patches existing rows. Self-continues via
 * `scheduler.runAfter(0, self, {cursor})` to stay within transaction limits.
 * Kick off from the Convex dashboard / CLI:
 * `npx convex run migrations/backfillUserProfiles:run`
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillUserProfiles.processBatch,
      {},
    );
    return { status: 'started' };
  },
});

export const processBatch = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result: {
      page: AuthUserDoc[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: { cursor: args.cursor ?? null, numItems: BATCH_SIZE },
    });

    for (const user of result.page) {
      await upsertUserProfile(ctx, user);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillUserProfiles.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return { processed: result.page.length, isDone: result.isDone };
  },
});

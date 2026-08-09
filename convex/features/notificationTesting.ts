import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';

/**
 * E2E test hooks for daily reminder pushes. Gated exactly like
 * features/authEmailTesting.ts and usage/testing.ts: every function throws
 * unless the deployment has `E2E_TEST_HOOKS=1` — enable it ONLY on dev/test
 * deployments (`pnpm exec convex env set E2E_TEST_HOOKS 1`), never in
 * production.
 *
 * While the flag is set, features/notificationDelivery.ts records what it WOULD
 * have sent into `testPushMessages` instead of calling a push service, so a test
 * can assert on the copy and the fan-out without a real device, real VAPID keys,
 * or a Firebase project.
 *
 * Capture mode is not the whole story for this feature. A reminder recurs, so
 * unlike the one-shot signup emails it keeps firing every day after
 * `e2e/global-teardown.ts` has cleared the flag — the delivery action therefore
 * ALSO refuses to send for a Playwright fixture account regardless of the flag
 * (see `isE2EFixtureUser`). This table is the assertion surface; that check is
 * the safety net.
 */

function assertTestHooksEnabled(): void {
  if (process.env.E2E_TEST_HOOKS !== '1') {
    throw new Error(
      'E2E test hooks are disabled (set E2E_TEST_HOOKS=1 on a dev deployment)',
    );
  }
}

/**
 * Capture hook for features/notificationDelivery.ts. The delivery action has no
 * `ctx.db`, so the write goes through this internal mutation — same shape as
 * `captureAuthEmail`.
 */
export const capturePush = internalMutation({
  args: {
    userId: v.string(),
    title: v.string(),
    body: v.string(),
    deviceCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    await ctx.db.insert('testPushMessages', {
      userId: args.userId,
      title: args.title,
      body: args.body,
      deviceCount: args.deviceCount,
      capturedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Most recent captured push for a user, or null.
 *
 * The `id` lets a poller tell a fresh capture from the previous one without
 * clearing the table, matching `latestAuthEmail`.
 */
export const latestPush = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id('testPushMessages'),
      title: v.string(),
      body: v.string(),
      deviceCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const doc = await ctx.db
      .query('testPushMessages')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .order('desc')
      .first();
    return doc
      ? {
          id: doc._id,
          title: doc.title,
          body: doc.body,
          deviceCount: doc.deviceCount,
        }
      : null;
  },
});

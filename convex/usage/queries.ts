import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAuthUserId } from '../db/users';
import { getActiveCourses } from '../db/courses';
import { featureStateValidator } from './helpers';

/**
 * Get the local quota document for the authenticated user.
 * Returns null if not authenticated or no quotas synced yet.
 *
 * Besides feature balances, exposes the synced billing state used by the
 * payment-overdue dialog. `pastDue` is resolved server-side so no client
 * clock is involved in deciding whether the app is blocked; `pastDueSince`
 * is carried purely for the "overdue since {date}" copy.
 */
export const getMyQuotas = query({
  args: {},
  returns: v.union(
    v.object({
      features: v.record(v.string(), featureStateValidator),
      lastSyncedAt: v.number(),
      planStatus: v.optional(v.string()),
      pastDue: v.boolean(),
      pastDueSince: v.optional(v.number()),
      pastDueInvoiceUrl: v.optional(v.string()),
      /** Active courses that would be archived by dropping to the free plan. */
      activeCourseCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const userId = await getAuthUserId(ctx);
      if (!userId) return null;

      const doc = await ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .first();

      if (!doc) return null;
      const pastDue = doc.pastDueSince !== undefined;
      // Only needed to warn about course archival in the cancel flow, so
      // skip the extra read on the healthy path.
      const activeCourseCount = pastDue
        ? (await getActiveCourses(ctx, userId)).length
        : 0;
      return {
        features: doc.features,
        lastSyncedAt: doc.lastSyncedAt,
        planStatus: doc.planStatus,
        pastDue,
        pastDueSince: doc.pastDueSince,
        pastDueInvoiceUrl: doc.pastDueInvoiceUrl,
        activeCourseCount,
      };
    } catch {
      return null;
    }
  },
});

import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAuthUser } from '../db/users';
import { featureStateValidator } from './helpers';

/**
 * Get the local quota document for the authenticated user.
 * Returns null if not authenticated or no quotas synced yet.
 */
export const getMyQuotas = query({
  args: {},
  returns: v.union(
    v.object({
      features: v.record(v.string(), featureStateValidator),
      lastSyncedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      const user = await getAuthUser(ctx);
      if (!user) return null;

      const doc = await ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', user._id))
        .first();

      if (!doc) return null;
      return { features: doc.features, lastSyncedAt: doc.lastSyncedAt };
    } catch {
      return null;
    }
  },
});

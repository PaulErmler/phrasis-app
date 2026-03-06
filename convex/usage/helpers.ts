import { v, ConvexError } from 'convex/values';
import { MutationCtx, QueryCtx, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc } from '../_generated/dataModel';

export type FeatureState = {
  balance: number;
  included: number;
  used: number;
  interval?: string;
  unlimited?: boolean;
};

export const featureStateValidator = v.object({
  balance: v.number(),
  included: v.number(),
  used: v.number(),
  interval: v.optional(v.string()),
  unlimited: v.optional(v.boolean()),
});

async function getQuotaDoc(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<Doc<'usageQuotas'> | null> {
  return ctx.db
    .query('usageQuotas')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .first();
}

/**
 * Check whether the user has enough quota for the given feature.
 * Returns { allowed, balance } without modifying anything.
 * If no quota doc or feature entry exists, returns allowed=false.
 */
export async function checkQuota(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<{ allowed: boolean; balance: number; synced: boolean }> {
  const doc = await getQuotaDoc(ctx, userId);
  if (!doc) {
    return { allowed: false, balance: 0, synced: false };
  }
  const feature = doc.features[featureId];
  if (!feature) {
    return { allowed: false, balance: 0, synced: true };
  }
  if (feature.unlimited) {
    return { allowed: true, balance: feature.balance, synced: true };
  }
  return {
    allowed: feature.balance >= amount,
    balance: feature.balance,
    synced: true,
  };
}

/**
 * Decrement the local quota for a feature.
 * Does NOT check — caller must check first or use `useQuota`.
 */
export async function decrementQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<number> {
  const doc = await getQuotaDoc(ctx, userId);
  if (!doc) {
    throw new ConvexError(`No quota doc for user. Sync quotas first.`);
  }
  const feature = doc.features[featureId];
  if (!feature) {
    throw new ConvexError(`No quota entry for feature "${featureId}". Sync quotas first.`);
  }
  const newBalance = feature.balance - amount;
  const newUsed = feature.used + amount;
  const updatedFeatures = {
    ...doc.features,
    [featureId]: { ...feature, balance: newBalance, used: newUsed },
  };
  await ctx.db.patch(doc._id, { features: updatedFeatures });
  return newBalance;
}

/**
 * Combined check + decrement. Throws ConvexError if not allowed.
 * Schedules trackUsage action automatically.
 */
export async function useQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<{ balance: number }> {
  const { allowed, balance, synced } = await checkQuota(ctx, userId, featureId, amount);

  if (!synced) {
    throw new ConvexError({
      code: 'QUOTA_NOT_SYNCED',
      message: `Quotas not yet synced. Please wait and try again.`,
      featureId,
    });
  }

  if (!allowed) {
    throw new ConvexError({
      code: 'USAGE_LIMIT',
      message: `Usage limit reached for "${featureId}".`,
      featureId,
      balance,
    });
  }

  const newBalance = await decrementQuota(ctx, userId, featureId, amount);

  await ctx.scheduler.runAfter(0, internal.usage.tracking.trackUsage, {
    userId,
    featureId,
    value: amount,
  });

  return { balance: newBalance };
}

/**
 * Overwrite all features in the user's quota doc at once.
 * Called during full sync from Autumn's GET /customers response.
 */
export const syncAllFeatures = internalMutation({
  args: {
    userId: v.string(),
    features: v.record(v.string(), featureStateValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await getQuotaDoc(ctx, args.userId);
    const now = Date.now();

    if (doc) {
      await ctx.db.patch(doc._id, {
        features: args.features,
        lastSyncedAt: now,
      });
    } else {
      await ctx.db.insert('usageQuotas', {
        userId: args.userId,
        features: args.features,
        lastSyncedAt: now,
      });
    }
    return null;
  },
});

/**
 * Delete the quota doc for a user (for testing/reset).
 */
export const resetQuotas = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await getQuotaDoc(ctx, args.userId);
    if (doc) {
      await ctx.db.delete(doc._id);
    }
    return null;
  },
});

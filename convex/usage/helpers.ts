import { v, ConvexError } from 'convex/values';
import { MutationCtx, QueryCtx, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Doc } from '../_generated/dataModel';
import { CREDIT_COSTS, FEATURE_IDS, type FeatureId } from '../features/featureIds';
import { getActiveCourses } from '../db/courses';
import { getUserSettings } from '../db/users';

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
 * Resolve which local balance a feature consumption applies to.
 *
 * Credit-consuming features (see CREDIT_COSTS) draw from the shared
 * `credits` balance when the user's plan grants one — the amount is
 * converted via the feature's credit cost. Users on legacy (pre-credits)
 * plan versions have per-feature balances instead, so we fall back to the
 * feature's own entry when no `credits` balance exists.
 *
 * Note: Autumn tracking always receives the UNDERLYING feature id — only
 * the local mirror is credit-aware. If a user somehow holds both a direct
 * feature balance and credits, Autumn consumes the direct balance first;
 * the post-track sync re-converges the local cache in that case.
 */
function resolveQuotaTarget(
  doc: Doc<'usageQuotas'>,
  featureId: string,
  amount: number,
): { targetFeatureId: string; targetAmount: number } {
  const creditCost = CREDIT_COSTS[featureId as FeatureId];
  if (creditCost !== undefined && doc.features[FEATURE_IDS.CREDITS]) {
    return {
      targetFeatureId: FEATURE_IDS.CREDITS,
      targetAmount: amount * creditCost,
    };
  }
  return { targetFeatureId: featureId, targetAmount: amount };
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
  const { targetFeatureId, targetAmount } = resolveQuotaTarget(
    doc,
    featureId,
    amount,
  );
  const feature = doc.features[targetFeatureId];
  if (!feature) {
    return { allowed: false, balance: 0, synced: true };
  }
  if (feature.unlimited) {
    return { allowed: true, balance: feature.balance, synced: true };
  }
  return {
    allowed: feature.balance >= targetAmount,
    balance: feature.balance,
    synced: true,
  };
}

/**
 * Check whether a boolean feature is available for the user.
 * Mirrors the frontend `useFeatureQuota.isAvailable` logic.
 * `synced: false` means no quota doc yet — same notion as `checkQuota`.
 */
export async function hasFeatureAccess(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  featureId: string,
): Promise<{ available: boolean; synced: boolean }> {
  const doc = await getQuotaDoc(ctx, userId);
  if (!doc) {
    return { available: false, synced: false };
  }
  const feature = doc.features[featureId];
  if (!feature) {
    return { available: false, synced: true };
  }
  if (feature.unlimited === true) {
    return { available: true, synced: true };
  }
  return { available: feature.balance > 0, synced: true };
}

/**
 * Decrement the local quota for a feature.
 * Does NOT check — caller must check first or use `consumeQuota`.
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
  const { targetFeatureId, targetAmount } = resolveQuotaTarget(
    doc,
    featureId,
    amount,
  );
  const feature = doc.features[targetFeatureId];
  if (!feature) {
    throw new ConvexError(`No quota entry for feature "${targetFeatureId}". Sync quotas first.`);
  }
  const newBalance = feature.balance - targetAmount;
  const newUsed = feature.used + targetAmount;
  const updatedFeatures = {
    ...doc.features,
    [targetFeatureId]: { ...feature, balance: newBalance, used: newUsed },
  };
  await ctx.db.patch(doc._id, { features: updatedFeatures });
  return newBalance;
}

/**
 * Increment the local quota for a feature.
 * Used for release semantics (e.g. archiving a course frees a slot).
 */
export async function incrementQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<number> {
  const doc = await getQuotaDoc(ctx, userId);
  if (!doc) {
    throw new ConvexError(`No quota doc for user. Sync quotas first.`);
  }
  const { targetFeatureId, targetAmount } = resolveQuotaTarget(
    doc,
    featureId,
    amount,
  );
  const feature = doc.features[targetFeatureId];
  if (!feature) {
    throw new ConvexError(`No quota entry for feature "${targetFeatureId}". Sync quotas first.`);
  }
  const newBalance = feature.balance + targetAmount;
  const newUsed = Math.max(feature.used - targetAmount, 0);
  const updatedFeatures = {
    ...doc.features,
    [targetFeatureId]: { ...feature, balance: newBalance, used: newUsed },
  };
  await ctx.db.patch(doc._id, { features: updatedFeatures });
  return newBalance;
}

/**
 * Combined check + decrement. Throws ConvexError if not allowed.
 * Schedules trackUsage action automatically.
 */
export async function consumeQuota(
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
 * Optimistically release quota locally and reconcile with Autumn asynchronously.
 * Mirrors `consumeQuota` but tracks a negative usage value.
 */
export async function releaseQuota(
  ctx: MutationCtx,
  userId: string,
  featureId: string,
  amount: number = 1,
): Promise<{ balance: number }> {
  const newBalance = await incrementQuota(ctx, userId, featureId, amount);

  await ctx.scheduler.runAfter(0, internal.usage.tracking.trackUsage, {
    userId,
    featureId,
    value: -amount,
  });

  return { balance: newBalance };
}

/**
 * Charge the post-generation remainder of a chat message's dynamic credit
 * cost (1 credit is consumed up-front in `sendMessage`; this adds 1 credit
 * per additional started CHAT_CREDIT_USD_STEP of actual LLM cost). Applied
 * without a balance check — the work is already done, so the balance may go
 * negative and block the next message instead.
 *
 * No-op for users on legacy plan versions (no `credits` balance): their
 * chat costs a flat 1 chat_messages unit per message.
 */
export const chargeExtraChatCredits = internalMutation({
  args: {
    userId: v.string(),
    extraCredits: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.extraCredits <= 0) return null;
    const doc = await getQuotaDoc(ctx, args.userId);
    if (!doc || !doc.features[FEATURE_IDS.CREDITS]) return null;

    await decrementQuota(
      ctx,
      args.userId,
      FEATURE_IDS.CHAT_MESSAGES,
      args.extraCredits,
    );

    await ctx.scheduler.runAfter(0, internal.usage.tracking.trackUsage, {
      userId: args.userId,
      featureId: FEATURE_IDS.CHAT_MESSAGES,
      value: args.extraCredits,
    });

    return null;
  },
});

/**
 * Overwrite all features in the user's quota doc at once.
 * Called during full sync from Autumn's GET /customers response.
 * Auto-archives excess active courses when plan limits are exceeded.
 */
export const syncAllFeatures = internalMutation({
  args: {
    userId: v.string(),
    features: v.record(v.string(), featureStateValidator),
    // Current Autumn plan, when derivable from the customer response.
    // Omitted → existing plan fields on the doc are left untouched.
    planId: v.optional(v.string()),
    planName: v.optional(v.string()),
    planStatus: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await getQuotaDoc(ctx, args.userId);
    const now = Date.now();

    const newIncluded = args.features[FEATURE_IDS.COURSES]?.included;

    const planFields =
      args.planId !== undefined
        ? {
          planId: args.planId,
          planName: args.planName,
          planStatus: args.planStatus,
        }
        : {};

    if (doc) {
      await ctx.db.patch(doc._id, {
        features: args.features,
        lastSyncedAt: now,
        ...planFields,
      });
    } else {
      await ctx.db.insert('usageQuotas', {
        userId: args.userId,
        features: args.features,
        lastSyncedAt: now,
        ...planFields,
      });
    }

    if (newIncluded !== undefined) {
      const activeCourses = await getActiveCourses(ctx, args.userId);
      const overLimit = activeCourses.length > newIncluded;
      if (overLimit) {
        const settings = await getUserSettings(ctx, args.userId);
        const protectedId = settings?.activeCourseId;

        // Archive courses that aren't the user's current active course
        let toArchive = activeCourses.filter((c) => c._id !== protectedId);
        // Only archive what's needed to reach the new plan limit (keep at least 1)
        const excess = activeCourses.length - Math.max(newIncluded, 1);
        toArchive = toArchive.slice(0, excess);

        // NOTE: We intentionally do NOT call releaseQuota() here.
        // The features record was just overwritten with Autumn's authoritative
        // state, so the balance already reflects the new plan limits.
        for (const course of toArchive) {
          await ctx.db.patch(course._id, {
            isArchived: true,
            archivedAt: now,
          });
        }
      }
    }

    return null;
  },
});


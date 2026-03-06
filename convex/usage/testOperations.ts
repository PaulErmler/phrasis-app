import { v, ConvexError } from 'convex/values';
import { mutation, action } from '../_generated/server';
import { internal } from '../_generated/api';
import { requireAuthUser } from '../db/users';
import { useQuota, checkQuota } from './helpers';
import { FEATURE_IDS } from '../features/featureIds';

function catchQuotaError(e: unknown): { allowed: false; balance: 0 } {
  if (e instanceof ConvexError) {
    const data = e.data as Record<string, unknown>;
    if (data.code === 'USAGE_LIMIT' || data.code === 'QUOTA_NOT_SYNCED') {
      return { allowed: false, balance: 0 };
    }
  }
  throw e;
}

/**
 * Simulate consuming a chat message.
 */
export const simulateChatMessage = mutation({
  args: {},
  returns: v.object({ allowed: v.boolean(), balance: v.number() }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    try {
      const result = await useQuota(ctx, user._id, FEATURE_IDS.CHAT_MESSAGES, 1);
      return { allowed: true, balance: result.balance };
    } catch (e) {
      return catchQuotaError(e);
    }
  },
});

/**
 * Simulate consuming sentences (from a non-custom collection).
 */
export const simulateSentence = mutation({
  args: { count: v.optional(v.number()) },
  returns: v.object({ allowed: v.boolean(), balance: v.number() }),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    try {
      const result = await useQuota(ctx, user._id, FEATURE_IDS.SENTENCES, args.count ?? 1);
      return { allowed: true, balance: result.balance };
    } catch (e) {
      return catchQuotaError(e);
    }
  },
});

/**
 * Simulate consuming a custom sentence (e.g. approveCard).
 */
export const simulateCustomSentence = mutation({
  args: {},
  returns: v.object({ allowed: v.boolean(), balance: v.number() }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    try {
      const result = await useQuota(ctx, user._id, FEATURE_IDS.CUSTOM_SENTENCES, 1);
      return { allowed: true, balance: result.balance };
    } catch (e) {
      return catchQuotaError(e);
    }
  },
});

/**
 * Simulate creating a course.
 */
export const simulateCourse = mutation({
  args: {},
  returns: v.object({ allowed: v.boolean(), balance: v.number() }),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    try {
      const result = await useQuota(ctx, user._id, FEATURE_IDS.COURSES, 1);
      return { allowed: true, balance: result.balance };
    } catch (e) {
      return catchQuotaError(e);
    }
  },
});

/**
 * Check quota for a feature without consuming it.
 */
export const checkFeatureQuota = mutation({
  args: { featureId: v.string() },
  returns: v.object({
    allowed: v.boolean(),
    balance: v.number(),
    synced: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    return checkQuota(ctx, user._id, args.featureId);
  },
});

/**
 * Reset all local quotas for the current user (for testing).
 */
export const resetMyQuotas = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    await ctx.runMutation(internal.usage.helpers.resetQuotas, {
      userId: user._id,
    });
    return null;
  },
});

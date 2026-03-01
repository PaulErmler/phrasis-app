"use node";

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { requireAuthUser } from '../db/users';
import { fetchCustomerFeatures, syncQuotasForUser, toFeaturesRecord } from './tracking';

/**
 * Full sync of all features from Autumn (single API call).
 */
export const syncQuotas = action({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    await syncQuotasForUser(ctx, user._id);
    return null;
  },
});

/**
 * Fetch live Autumn entitlements without writing to DB (for prototype comparison).
 */
export const getAutumnEntitlements = action({
  args: {},
  returns: v.record(
    v.string(),
    v.object({
      balance: v.number(),
      included: v.number(),
      used: v.number(),
      interval: v.optional(v.string()),
      unlimited: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);
    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) throw new Error('AUTUMN_SECRET_KEY environment variable is not set');
    const autumnFeatures = await fetchCustomerFeatures(secretKey, user._id);
    if (!autumnFeatures) return {};
    return toFeaturesRecord(autumnFeatures);
  },
});

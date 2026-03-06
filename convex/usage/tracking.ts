"use node";

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import { type FeatureState } from './helpers';

const AUTUMN_API = 'https://api.useautumn.com/v1';

function getSecretKey(): string {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error('AUTUMN_SECRET_KEY environment variable is not set');
  return key;
}

export type AutumnFeatureEntry = {
  id: string;
  type: string;
  name: string | null;
  interval: string | null;
  interval_count: number | null;
  unlimited: boolean | null;
  balance: number | null;
  usage: number | null;
  included_usage: number | null;
  next_reset_at: number | null;
  overage_allowed: boolean | null;
};

type AutumnCustomerResponse = {
  id: string;
  features: Record<string, AutumnFeatureEntry>;
};

/**
 * Track usage with Autumn and sync the tracked feature back to Convex.
 * Called from mutations via scheduler.runAfter.
 */
export const trackUsage = internalAction({
  args: {
    userId: v.string(),
    featureId: v.string(),
    value: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secretKey = getSecretKey();

    const trackRes = await fetch(`${AUTUMN_API}/track`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customer_id: args.userId,
        feature_id: args.featureId,
        value: args.value,
      }),
    });

    if (!trackRes.ok) {
      const body = await trackRes.text();
      console.error(`Autumn track failed (${trackRes.status}): ${body}`);
      return null;
    }

    const autumnFeatures = await fetchCustomerFeatures(secretKey, args.userId);
    if (!autumnFeatures) return null;

    await ctx.runMutation(internal.usage.helpers.syncAllFeatures, {
      userId: args.userId,
      features: toFeaturesRecord(autumnFeatures),
    });

    return null;
  },
});

/**
 * Fetch all features for a customer in a single request.
 */
export async function fetchCustomerFeatures(
  secretKey: string,
  userId: string,
): Promise<Record<string, AutumnFeatureEntry> | null> {
  const res = await fetch(`${AUTUMN_API}/customers/${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Autumn get customer failed (${res.status}): ${body}`);
    return null;
  }

  const data: AutumnCustomerResponse = await res.json();
  return data.features;
}

/**
 * Convert Autumn's features dict to our local format.
 */
export function toFeaturesRecord(
  autumnFeatures: Record<string, AutumnFeatureEntry>,
): Record<string, FeatureState> {
  const result: Record<string, FeatureState> = {};
  for (const [id, entry] of Object.entries(autumnFeatures)) {
    result[id] = {
      balance: entry.balance ?? 0,
      included: entry.included_usage ?? 0,
      used: entry.usage ?? 0,
      interval: entry.interval ?? undefined,
      unlimited: entry.unlimited ?? undefined,
    };
  }
  return result;
}

export const syncQuotasInternal = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await syncQuotasForUser(ctx, args.userId);
    return null;
  },
});

export async function syncQuotasForUser(
  ctx: { runMutation: (ref: any, args: any) => Promise<any> },
  userId: string,
): Promise<void> {
  const secretKey = getSecretKey();
  const autumnFeatures = await fetchCustomerFeatures(secretKey, userId);
  if (!autumnFeatures) return;

  await ctx.runMutation(internal.usage.helpers.syncAllFeatures, {
    userId,
    features: toFeaturesRecord(autumnFeatures),
  });
}


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

type AutumnFlagEntry = {
  id: string;
  plan_id: string | null;
  expires_at: number | null;
  feature_id: string;
};

type AutumnCustomerResponse = {
  id: string;
  features?: Record<string, AutumnFeatureEntry>;
  balances?: Record<string, AutumnFeatureEntry>;
  flags?: Record<string, AutumnFlagEntry>;
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

    const customerData = await fetchCustomerData(secretKey, args.userId);
    if (!customerData) return null;

    await ctx.runMutation(internal.usage.helpers.syncAllFeatures, {
      userId: args.userId,
      features: toFeaturesRecord(customerData),
    });

    return null;
  },
});

/**
 * Fetch customer data including both metered features and boolean flags.
 */
export async function fetchCustomerData(
  secretKey: string,
  userId: string,
): Promise<AutumnCustomerResponse | null> {
  const res = await fetch(`${AUTUMN_API}/customers/${encodeURIComponent(userId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Autumn get customer failed (${res.status}): ${body}`);
    return null;
  }

  return await res.json();
}

/**
 * Convert Autumn's customer response to our local format.
 * Boolean features (type === 'boolean') are stored with unlimited=true
 * so that checkQuota / useFeatureQuota treat them as "available".
 * Also handles the newer API format where boolean features appear
 * in a separate `flags` field instead of `features`.
 */
export function toFeaturesRecord(
  data: AutumnCustomerResponse,
): Record<string, FeatureState> {
  const result: Record<string, FeatureState> = {};

  const allFeatures = data.features ?? data.balances ?? {};
  for (const [id, entry] of Object.entries(allFeatures)) {
    if (entry.type === 'boolean' || entry.type === 'static') {
      result[id] = { balance: 1, included: 1, used: 0, unlimited: true };
    } else {
      result[id] = {
        balance: entry.balance ?? 0,
        included: entry.included_usage ?? 0,
        used: entry.usage ?? 0,
        interval: entry.interval ?? undefined,
        unlimited: entry.unlimited ?? undefined,
      };
    }
  }

  if (data.flags) {
    for (const [id] of Object.entries(data.flags)) {
      result[id] = { balance: 1, included: 1, used: 0, unlimited: true };
    }
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
  const customerData = await fetchCustomerData(secretKey, userId);
  if (!customerData) return;

  await ctx.runMutation(internal.usage.helpers.syncAllFeatures, {
    userId,
    features: toFeaturesRecord(customerData),
  });
}


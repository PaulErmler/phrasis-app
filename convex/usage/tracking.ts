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

/** Fields returned per balance entry by `GET /customers/:id`. */
export type AutumnBalanceEntry = {
  feature_id: string;
  granted: number;
  remaining: number;
  usage: number;
  unlimited: boolean;
  overage_allowed: boolean;
  next_reset_at: number | null;
};

type AutumnFlagEntry = {
  id: string;
  plan_id: string | null;
  expires_at: number | null;
  feature_id: string;
};

type AutumnCustomerResponse = {
  id: string;
  balances?: Record<string, AutumnBalanceEntry>;
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
 * Fetch an existing customer via `GET /customers/:id`.
 * Used after `POST /track` where the customer is known to exist.
 */
export async function fetchCustomerData(
  secretKey: string,
  userId: string,
): Promise<AutumnCustomerResponse | null> {
  const res = await fetch(
    `${AUTUMN_API}/customers/${encodeURIComponent(userId)}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`Autumn get customer failed (${res.status}): ${body}`);
    return null;
  }

  return (await res.json()) as AutumnCustomerResponse;
}

/**
 * Idempotent getOrCreate via `POST /customers`.
 * Creates the customer if new; returns existing if known.
 * Combined with `autoEnable: true` on the free plan, this also
 * attaches the free plan automatically for new customers.
 */
async function getOrCreateCustomer(
  secretKey: string,
  userId: string,
): Promise<AutumnCustomerResponse | null> {
  const res = await fetch(`${AUTUMN_API}/customers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: userId }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Autumn getOrCreate customer failed (${res.status}): ${body}`);
    return null;
  }

  return (await res.json()) as AutumnCustomerResponse;
}

/**
 * Convert Autumn's customer response to our local FeatureState format.
 *
 * Metered features come from `balances` (fields: granted/remaining/usage).
 * Boolean features come from `flags` (on/off access).
 */
export function toFeaturesRecord(
  data: AutumnCustomerResponse,
): Record<string, FeatureState> {
  const result: Record<string, FeatureState> = {};

  for (const [id, entry] of Object.entries(data.balances ?? {})) {
    result[id] = {
      balance: entry.remaining,
      included: entry.granted,
      used: entry.usage,
      unlimited: entry.unlimited || undefined,
    };
  }

  if (data.flags) {
    for (const [id] of Object.entries(data.flags)) {
      result[id] = { balance: 1, included: 1, used: 0, unlimited: true };
    }
  }

  return result;
}

/** Pass JWT `subject` (same id as Autumn `customerId` and `useQuota`), not Convex user table `_id`. */
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
  const customerData = await getOrCreateCustomer(secretKey, userId);
  if (!customerData) return;

  const features = toFeaturesRecord(customerData);

  await ctx.runMutation(internal.usage.helpers.syncAllFeatures, {
    userId,
    features,
  });
}

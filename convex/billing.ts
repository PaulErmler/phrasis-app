"use node";

import { v } from 'convex/values';
import { action } from './_generated/server';
import { syncQuotasForUser } from './usage/tracking';

const AUTUMN_API = 'https://api.useautumn.com/v1';

function getSecretKey(): string {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error('AUTUMN_SECRET_KEY environment variable is not set');
  return key;
}

async function autumnFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  apiVersion: string,
): Promise<T> {
  const res = await fetch(`${AUTUMN_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
      'x-api-version': apiVersion,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    console.error(`Autumn ${method} ${path} failed (${res.status}): ${text}`);
    const err = json as { message?: string; code?: string } | null;
    throw new Error(
      `Autumn request failed: ${err?.message ?? err?.code ?? res.status}`,
    );
  }
  return json as T;
}

type LegacyCustomerProduct = {
  id: string;
  status: string;
  is_default: boolean;
  is_add_on: boolean;
  trial_ends_at: number | null;
  current_period_end: number | null;
};

/**
 * Switch a currently-trialing customer to another paid plan without
 * restarting, extending, or losing their running trial.
 *
 * Autumn's defaults get this wrong in both directions: an upgrade grants a
 * fresh full trial on the new plan (per-plan dedup only → trial-hopping),
 * while passing `free_trial: false` would end the trial and bill
 * immediately. Verified behavior (July 2026, api v1.2 / v2.1.0):
 *
 * - Autumn-classified downgrades are scheduled at trial end with the
 *   target's trial config ignored — the running trial is untouched, so a
 *   plain legacy `/attach` (no trial params) is exactly right. Passing
 *   `customize.free_trial` here would re-anchor the current trial's end.
 * - Autumn-classified upgrades switch immediately; `customize.free_trial`
 *   with the remaining duration carries the trial over (it bypasses
 *   per-plan dedup and re-anchors from now, so `ceil` never shortens it).
 *
 * The direction is decided by Autumn's own classification (a `/checkout`
 * preview), not our tier ranking — attach behavior follows Autumn's
 * classifier, so the two must agree.
 */
export const switchPlanDuringTrial = action({
  args: { productId: v.string() },
  returns: v.object({
    mode: v.union(v.literal('scheduled'), v.literal('immediate')),
    trialEndsAt: v.union(v.number(), v.null()),
    paymentUrl: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');
    const customerId = identity.subject;

    // Server-side verification — never trust the client's trial state.
    const customer = await autumnFetch<{
      products?: LegacyCustomerProduct[];
    }>('GET', `/customers/${encodeURIComponent(customerId)}`, undefined, '1.2');
    const products = customer?.products ?? [];
    const trialing = products.find(
      (p) => !p.is_default && !p.is_add_on && p.status === 'trialing',
    );
    if (!trialing) {
      throw new Error('No active trial — use the regular checkout flow');
    }
    if (trialing.id === args.productId) {
      throw new Error('Already trialing this plan');
    }
    // The legacy (v1.2) shape reports the trial end via current_period_end
    // and leaves trial_ends_at null while trialing.
    const trialEndsAt =
      trialing.trial_ends_at ?? trialing.current_period_end ?? null;
    if (!trialEndsAt || trialEndsAt <= Date.now()) {
      throw new Error('Trial end date unavailable or already passed');
    }

    const preview = await autumnFetch<{
      product?: { scenario?: string };
    }>(
      'POST',
      '/checkout',
      { customer_id: customerId, product_id: args.productId },
      '1.2',
    );
    const scenario = preview?.product?.scenario;

    let mode: 'scheduled' | 'immediate';
    let paymentUrl: string | null = null;

    if (scenario === 'downgrade') {
      await autumnFetch(
        'POST',
        '/attach',
        { customer_id: customerId, product_id: args.productId },
        '1.2',
      );
      mode = 'scheduled';
    } else if (scenario === 'upgrade' || scenario === 'new') {
      // Nearest whole day: the v2 API only takes whole-day durations, and
      // Autumn anchors Stripe-checkout trials a few minutes PAST the day
      // boundary (7d + ~10min) — ceil would then hand out an extra day and
      // move the calendar end date; rounding keeps it stable (±minutes).
      const remainingDays = Math.max(
        1,
        Math.round((trialEndsAt - Date.now()) / 86_400_000),
      );
      const result = await autumnFetch<{ payment_url?: string | null }>(
        'POST',
        '/billing.attach',
        {
          customer_id: customerId,
          plan_id: args.productId,
          redirect_mode: 'if_required',
          customize: {
            free_trial: {
              duration_length: remainingDays,
              duration_type: 'day',
              card_required: true,
            },
          },
        },
        '2.1.0',
      );
      // Card is normally on file (trials are card-required), so no
      // payment redirect is expected — surface it if Autumn asks anyway.
      paymentUrl = result?.payment_url ?? null;
      mode = 'immediate';
    } else {
      throw new Error(
        `Plan switch not applicable during trial (scenario: ${scenario ?? 'unknown'})`,
      );
    }

    await syncQuotasForUser(ctx, customerId);

    return { mode, trialEndsAt, paymentUrl };
  },
});

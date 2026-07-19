import { v } from "convex/values";
import { components } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { Autumn } from "@useautumn/convex";
import { getTrialState } from "../lib/autumn/trial-eligibility";

const secretKey = (() => {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error('Missing required Convex environment variable: AUTUMN_SECRET_KEY');
  return key;
})();

export const autumn = new Autumn(components.autumn, {
  secretKey,
  identify: async (ctx: any) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) return null

    return {
      customerId: user.subject as string,
      customerData: {
        name: user.name as string,
        email: user.email as string,
      },
    };
  },
});

/**
 * These exports are required for our react hooks and components
 */

export const {
  track,
  cancel,
  query,
  check,
  usage,
  setupPayment,
  createCustomer,
  listProducts,
  billingPortal,
  createReferralCode,
  redeemReferralCode,
  createEntity,
  getEntity,
} = autumn.api();

/**
 * Server-side trial gate for `attach` / `checkout`.
 *
 * Autumn's built-in trial dedup is per-plan only, and the anti-hopping
 * policy (one trial ever, across all plans — see
 * lib/autumn/trial-eligibility.ts) used to live purely in the client via
 * `checkoutTrialParams()`. Anyone invoking these public actions directly
 * could therefore collect a fresh trial on every plan. The gate re-derives
 * eligibility here, where the calls actually execute, from the durable
 * `trials_used` record:
 *
 * - trial-eligible (never trialed, no paid plan): args pass through and
 *   Autumn starts the plan's configured trial.
 * - currently trialing: `attach` is rejected — plan switches (including
 *   dropping to the Free plan, which is scheduled at trial end) must go
 *   through `switchPlanDuringTrial` (convex/billing.ts), which carries the
 *   running trial over instead of granting a fresh one. `checkout` (the
 *   dialog's preview) proceeds with `freeTrial: false` so no checkout
 *   session that grants a new trial can be completed; the dialog overrides
 *   preview copy/amounts for trialing users anyway.
 * - everyone else: `freeTrial: false` is forced, mirroring what the
 *   well-behaved client already sends.
 */
async function gateTrialArgs<T extends { freeTrial?: boolean }>(
  ctx: ActionCtx,
  kind: 'attach' | 'checkout',
  args: T,
): Promise<T> {
  const identity = await ctx.auth.getUserIdentity();
  // Unauthenticated calls are rejected by the component's identify().
  if (!identity) return args;

  const res = await fetch(
    `https://api.useautumn.com/v1/customers/${encodeURIComponent(identity.subject)}?expand=trials_used`,
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'x-api-version': '1.2',
      },
    },
  );
  // Unknown customer — nothing attached yet, so no trial history either.
  if (res.status === 404) return args;
  if (!res.ok) {
    const body = await res.text();
    console.error(`Autumn trial-gate customer fetch failed (${res.status}): ${body}`);
    throw new Error('Could not verify trial eligibility — please retry');
  }
  const customer = (await res.json()) as {
    products?: unknown;
    trials_used?: unknown;
  };

  const state = getTrialState(customer);
  if (state.trialEligible) return args;
  if (state.onTrial && kind === 'attach') {
    throw new Error(
      'Plan switches during a trial must go through switchPlanDuringTrial',
    );
  }
  return { ...args, freeTrial: false };
}

const customerDataValidator = v.object({
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  fingerprint: v.optional(v.string()),
});

/** Mirrors the component's AttachArgs / CheckoutArgs (not exported by the package). */
const checkoutSharedArgs = {
  productId: v.optional(v.string()),
  productIds: v.optional(v.array(v.string())),
  entityId: v.optional(v.string()),
  options: v.optional(
    v.array(v.object({ featureId: v.string(), quantity: v.number() })),
  ),
  freeTrial: v.optional(v.boolean()),
  successUrl: v.optional(v.string()),
  forceCheckout: v.optional(v.boolean()),
  customerData: v.optional(customerDataValidator),
  entityData: v.optional(v.any()),
  checkoutSessionParams: v.optional(v.record(v.string(), v.any())),
  reward: v.optional(v.string()),
  invoice: v.optional(v.boolean()),
};

export const attach = action({
  args: { ...checkoutSharedArgs, metadata: v.optional(v.object({})) },
  handler: async (ctx, args) => {
    const gated = await gateTrialArgs(ctx, 'attach', args);
    return await autumn.attach(ctx, gated);
  },
});

export const checkout = action({
  args: checkoutSharedArgs,
  handler: async (ctx, args) => {
    const gated = await gateTrialArgs(ctx, 'checkout', args);
    return await autumn.checkout(ctx, gated);
  },
});

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
 * Public actions required by our autumn-js react hooks — and ONLY those.
 *
 * `autumn.api()` offers the component's full surface (track, cancel, usage,
 * setupPayment, entities, referrals, ...), but every one of these is a
 * PUBLIC action scoped to the caller's own Autumn customer. `track` in
 * particular accepts an unbounded `value: number` — and Autumn credits
 * negative values (our own refund path relies on that: releaseQuota tracks
 * `-amount`) — so exporting it let any authenticated user grant themselves
 * usage from the browser console. No client code ever called the removed
 * ones (the hooks use exactly the four below plus attach/checkout further
 * down; all real usage tracking is server-side via
 * internal.usage.tracking.trackUsage), so they are simply not exported.
 * autumn-js only dereferences `convexApi.<name>` at call time, so the
 * missing endpoints are inert unless something actually calls them.
 */
export const { createCustomer, listProducts, billingPortal } = autumn.api();

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
export async function gateTrialArgs<T extends { freeTrial?: boolean }>(
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

/**
 * `check` for the paywall preview (usePaywall calls it with
 * `withPreview: true`). Registered by hand instead of re-exported from
 * `autumn.api()` so that `sendEvent` is force-disabled: with
 * `sendEvent: true` the component's check RECORDS a usage event of
 * `requiredBalance` (an unbounded, sign-free number), which would be the
 * same self-service balance manipulation as the removed public `track`.
 * The client only ever previews.
 */
export const check = action({
  args: {
    // Mirrors the component's CheckArgs (not exported by the package),
    // minus nothing — sendEvent is accepted but ignored.
    productId: v.optional(v.string()),
    featureId: v.optional(v.string()),
    requiredBalance: v.optional(v.number()),
    sendEvent: v.optional(v.boolean()),
    withPreview: v.optional(v.boolean()),
    entityId: v.optional(v.string()),
    customerData: v.optional(customerDataValidator),
    entityData: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await autumn.check(ctx, { ...args, sendEvent: false });
  },
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

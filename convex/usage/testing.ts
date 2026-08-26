import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { normalizePlans } from '../../lib/autumn/customer-shape';
import { AUTUMN_API, getSecretKey } from './autumnClient';
import {
  assertTestHooksEnabled,
  requireUserIdByEmail,
} from '../lib/testHooks';

/**
 * E2E test hooks for the payment-overdue (dunning) flow. Every function
 * here throws unless the deployment has `E2E_TEST_HOOKS=1` set. Enable it
 * ONLY on dev/test deployments (`pnpm exec convex env set E2E_TEST_HOOKS 1`),
 * never in production.
 *
 * Invoked from Playwright specs via
 * `pnpm exec convex run usage/testing:<fn> '<json>'` (see e2e/payment-overdue.spec.ts).
 *
 * Why an override instead of a real failed payment: a genuine `past_due`
 * only arises from a failed RENEWAL invoice, and Stripe test clocks can't
 * be attached to customers Autumn creates on its own. The obvious shortcut
 * Attach with `free_trial: false` while test card 4000-0000-0000-0341
 * (attaches fine, charges fail) is on file. Was tried and does NOT work
 * (verified July 2026): the failed charge leaves an `open` (then voided)
 * invoice and an EMPTY products list, never `past_due`. So the e2e forces
 * the synced planStatus via `billingTestOverrides`, which syncAllFeatures
 * re-applies on every sync while E2E_TEST_HOOKS=1; everything downstream
 * (quota doc, reactive query, dialog, billing-portal call) is real.
 *
 * `relinkStripeCustomer` (below) is the OTHER route: pre-build the Stripe
 * customer WITH a test clock and hand it to Autumn, which makes genuinely
 * time-driven states (trial conversion, lapse, real past_due) reachable.
 * Used by e2e/billing-clock.spec.ts. The override stays for the cheap
 * dunning-UI spec that doesn't want minutes of clock advancing.
 */

/** Resolve a user's id from their email via the userProfiles mirror. */
export const resolveUserId = internalQuery({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    return requireUserIdByEmail(ctx, args.email);
  },
});

/**
 * Force the synced plan status for a user (e.g. 'past_due'). Writes the
 * override row (so every later sync re-applies it) AND patches the quota
 * doc immediately (so the reactive query flips without waiting for one).
 *
 * Refuses to force `past_due` on a customer without a paid plan: the free
 * plan is auto-attached and has no payment that can fail, so that state
 * cannot occur in production and any test built on it would be asserting
 * against fiction. Use the Stripe test-clock provisioning flow for a
 * genuine past_due (real failed renewal + real open invoice).
 */
export const setBillingOverride = internalMutation({
  args: { email: v.string(), planStatus: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);

    if (args.planStatus === 'past_due') {
      const quota = await ctx.db
        .query('usageQuotas')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .first();
      if (!quota?.planId || quota.planId === 'free') {
        throw new Error(
          `Cannot force past_due for "${args.email}": the customer has no paid ` +
            `plan (planId=${quota?.planId ?? 'none'}). Free plans have no ` +
            `payment to fail. Subscribe first, or use the test-clock flow.`,
        );
      }
    }

    const existing = await ctx.db
      .query('billingTestOverrides')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { planStatus: args.planStatus });
    } else {
      await ctx.db.insert('billingTestOverrides', {
        userId,
        planStatus: args.planStatus,
      });
    }

    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (!doc) throw new Error(`No usageQuotas doc for "${args.email}"`);
    await ctx.db.patch(doc._id, {
      planStatus: args.planStatus,
      pastDueSince:
        args.planStatus === 'past_due'
          ? (doc.pastDueSince ?? Date.now())
          : undefined,
    });
    return null;
  },
});

/**
 * Remove the override and restore a healthy local state; the next real
 * sync re-derives the truth from Autumn.
 */
export const clearBillingOverride = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const userId = await requireUserIdByEmail(ctx, args.email);

    const existing = await ctx.db
      .query('billingTestOverrides')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (existing) await ctx.db.delete(existing._id);

    const doc = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (doc) {
      await ctx.db.patch(doc._id, {
        planStatus: 'active',
        pastDueSince: undefined,
      });
    }
    return null;
  },
});

/**
 * Re-create a user's Autumn customer linked to a PRE-BUILT Stripe customer.
 * The Stripe-test-clock provisioning flow.
 *
 * Stripe test clocks can only be set at Stripe-customer creation, and Autumn
 * normally creates that customer itself during the first attach, which is
 * why clocks "can't attach to Autumn-created customers". The way around it
 * (Autumn's own test suite does exactly this, see initCustomerV3.ts in the
 * autumn repo): create the clocked Stripe customer FIRST via the Stripe API,
 * then create the Autumn customer with `stripe_id` pointing at it. Autumn
 * then runs every subscription for this customer on the clocked Stripe
 * customer, and advancing the clock produces REAL trial conversions,
 * renewals, failed payments, and cancellations.
 *
 * The Playwright spec (e2e/billing-clock.spec.ts) creates the clock and the
 * Stripe customer node-side with a Stripe TEST key; this hook does the
 * Autumn half, because AUTUMN_SECRET_KEY lives only in the Convex env. The
 * existing auto-created Autumn customer (signup attaches the free default
 * plan) is deleted first; re-creation attaches the free default again, so
 * the app-visible state is unchanged.
 */
export const relinkStripeCustomer = internalAction({
  args: { email: v.string(), stripeId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const key = getSecretKey();
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'x-api-version': '1.2',
    };
    const userId: string = await ctx.runQuery(
      internal.usage.testing.resolveUserId,
      { email: args.email },
    );

    // Tolerate 404: the Autumn customer may not exist yet if the user never
    // opened a billing surface.
    const del = await fetch(
      `${AUTUMN_API}/customers/${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers },
    );
    if (!del.ok && del.status !== 404) {
      throw new Error(`Autumn customer delete failed (${del.status})`);
    }

    const res = await fetch(`${AUTUMN_API}/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: userId,
        email: args.email,
        name: 'E2E Clock User',
        stripe_id: args.stripeId,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Autumn customer create with stripe_id failed (${res.status}): ${body}`,
      );
    }
    return null;
  },
});

/**
 * Attach a plan through Autumn's LEGACY v1.2 `/attach`. The way every
 * subscription was created before Managed Payments existed. With a card
 * already on file Autumn charges it directly and creates the subscription
 * WITHOUT a Stripe Checkout Session, i.e. a genuinely non-MoR subscription.
 *
 * This is how e2e/billing-clock.spec.ts manufactures a "grandfathered"
 * customer: someone whose subscription predates the MoR flag and must keep
 * working untouched (upgrades, downgrades, renew, cancel, the mixed-estate
 * steady state). It goes straight to Autumn's REST API on purpose,
 * BYPASSING the app's `guardFirstPurchaseOffLegacyPath`. The guard blocks
 * new first purchases from the legacy path; a subscription that already
 * exists is exactly what it must not touch.
 *
 * Fails loudly if Autumn returns a checkout_url instead of attaching
 * directly. That means no usable card was on the Stripe customer and the
 * "legacy customer" premise doesn't hold.
 */
export const legacyAttachPlan = internalAction({
  args: { email: v.string(), productId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const key = getSecretKey();
    const userId: string = await ctx.runQuery(
      internal.usage.testing.resolveUserId,
      { email: args.email },
    );
    const res = await fetch(`${AUTUMN_API}/attach`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'x-api-version': '1.2',
      },
      body: JSON.stringify({
        customer_id: userId,
        product_id: args.productId,
        free_trial: false,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      checkout_url?: string;
    };
    if (!res.ok) {
      throw new Error(`Autumn legacy attach failed (${res.status})`);
    }
    if (body.checkout_url) {
      throw new Error(
        'Legacy attach returned a checkout_url — no usable card on the ' +
          'Stripe customer; attach a payment method first',
      );
    }
    return null;
  },
});

/**
 * Immediately cancel the customer's current (non-default) plan via Autumn's
 * own `/cancel`. The same call the app's cancelOverdueSubscription makes.
 * Produces a genuinely lapsed customer (plan gone, `trials_used` kept, any
 * saved card surviving) for the billing-clock lapse/repurchase journey.
 *
 * Why Autumn-side and not a Stripe-side DELETE of the subscription: Autumn
 * does NOT ingest `customer.subscription.deleted` for Managed Payments
 * subscriptions. Two live probes (2026-08-10) left Autumn reporting
 * `trialing` 40+ minutes after the Stripe subscription was deleted, with
 * the event fired and fully delivered. Only Autumn's own cancel reliably
 * updates its state.
 */
export const cancelPlanNow = internalAction({
  args: { email: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const key = getSecretKey();
    const userId: string = await ctx.runQuery(
      internal.usage.testing.resolveUserId,
      { email: args.email },
    );
    const customerRes = await fetch(
      `${AUTUMN_API}/customers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${key}`, 'x-api-version': '1.2' } },
    );
    if (!customerRes.ok) {
      throw new Error(`Autumn customer fetch failed (${customerRes.status})`);
    }
    const plan = normalizePlans(
      (await customerRes.json()) as { products?: unknown },
    ).find((p) => !p.isDefault && !p.isAddOn && !p.isExpired && !p.isScheduled);
    if (!plan) throw new Error('No current plan to cancel');

    const res = await fetch(`${AUTUMN_API}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'x-api-version': '1.2',
      },
      body: JSON.stringify({
        customer_id: userId,
        product_id: plan.planId,
        cancel_immediately: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Autumn cancel failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return plan.planId;
  },
});
/**
 * Snapshot of the customer's Autumn products (status + past_due),
 * debugging aid for billing specs.
 */
export const getBillingDebugState = internalAction({
  args: { email: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      status: v.string(),
      pastDue: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    assertTestHooksEnabled();
    const key = getSecretKey();
    const userId: string = await ctx.runQuery(
      internal.usage.testing.resolveUserId,
      { email: args.email },
    );
    const res = await fetch(
      `${AUTUMN_API}/customers/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          'x-api-version': '1.2',
        },
      },
    );
    if (!res.ok) {
      throw new Error(`Autumn customer fetch failed (${res.status})`);
    }
    // Normalized rather than read raw: this endpoint is pinned to 1.2, which
    // reports delinquency as `status: 'past_due'` and ships no `past_due`
    // field at all, so reading the boolean directly (as this did) reported
    // `pastDue: false` for genuinely past-due customers.
    const customer = (await res.json()) as { products?: unknown };
    return normalizePlans(customer).map((p) => ({
      id: p.planId,
      status: p.rawStatus,
      pastDue: p.isPastDue,
    }));
  },
});

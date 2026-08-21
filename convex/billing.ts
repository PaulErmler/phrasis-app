"use node";

import { v } from 'convex/values';
import { action } from './_generated/server';
import {
  hasUnpaidInvoice,
  syncQuotasForUser,
  type AutumnInvoiceEntry,
} from './usage/tracking';
import {
  currentPlans,
  normalizePlans,
  type AutumnPlan,
} from '../lib/autumn/customer-shape';
import { getTrialState } from '../lib/autumn/trial-eligibility';
import { managedPaymentsCheckoutParams } from '../lib/autumn/managed-payments';
import { autumnFetch } from './usage/autumnClient';

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
 *   target's trial config ignored: the running trial is untouched, so a
 *   plain legacy `/attach` (no trial params) is exactly right. Passing
 *   `customize.free_trial` here would re-anchor the current trial's end.
 * - Autumn-classified upgrades switch immediately; `customize.free_trial`
 *   with the remaining duration carries the trial over (it bypasses
 *   per-plan dedup and re-anchors from now, so `ceil` never shortens it).
 * - The free (default) plan is a valid target too: it takes the scheduled
 *   path: the trial runs to its end, then the customer drops to Free.
 *   A free target must never reach the immediate `billing.attach` branch
 *   (its `customize.free_trial` would be meaningless there).
 * - Re-attaching the currently-trialing plan while a switch is scheduled
 *   ("renew") un-schedules that switch via a plain legacy attach: the
 *   trial keeps running as if nothing was ever scheduled.
 *
 * The direction is decided by Autumn's own classification (a `/checkout`
 * preview), not our tier ranking. Attach behavior follows Autumn's
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

    // Server-side verification, never trust the client's trial state.
    const customer = await autumnFetch<{ products?: unknown }>(
      'GET',
      `/customers/${encodeURIComponent(customerId)}`,
      undefined,
      '1.2',
    );
    // currentPlans: an early-cancelled trial leaves an `expired` entry with
    // trial_ends_at still in the future. It must not read as trialing.
    const trialing: AutumnPlan | undefined = currentPlans(
      normalizePlans(customer),
    ).find((p) => !p.isDefault && !p.isAddOn && p.isTrialing);
    if (!trialing) {
      throw new Error('No active trial — use the regular checkout flow');
    }
    // v1.2 reports the trial end via current_period_end and leaves
    // trial_ends_at null while trialing; normalizePlans absorbs that.
    const trialEndsAt = trialing.trialEndsAt ?? null;
    if (!trialEndsAt || trialEndsAt <= Date.now()) {
      throw new Error('Trial end date unavailable or already passed');
    }

    const preview = await autumnFetch<{
      product?: { scenario?: string; properties?: { is_free?: boolean } };
    }>(
      'POST',
      '/checkout',
      { customer_id: customerId, product_id: args.productId },
      '1.2',
    );
    const scenario = preview?.product?.scenario;
    const targetIsFree = preview?.product?.properties?.is_free === true;

    let mode: 'scheduled' | 'immediate';
    let paymentUrl: string | null = null;

    if (trialing.planId === args.productId && scenario !== 'renew') {
      throw new Error('Already trialing this plan');
    }
    if (
      targetIsFree &&
      scenario !== 'downgrade' &&
      scenario !== 'cancel' &&
      scenario !== 'renew'
    ) {
      throw new Error(
        `Plan switch not applicable during trial (scenario: ${scenario ?? 'unknown'})`,
      );
    }

    if (scenario === 'renew') {
      // Re-attaching the currently-trialing plan while another plan (or
      // Free) is scheduled to replace it: Autumn classifies this as
      // "renew" and a plain legacy attach just drops the scheduled
      // switch. The running trial is untouched (per-plan trial dedup
      // means no fresh trial is granted for a plan already trialed).
      await autumnFetch(
        'POST',
        '/attach',
        { customer_id: customerId, product_id: args.productId },
        '1.2',
      );
      mode = 'immediate';
    } else if (
      scenario === 'downgrade' ||
      (targetIsFree && scenario === 'cancel')
    ) {
      await autumnFetch(
        'POST',
        '/attach',
        { customer_id: customerId, product_id: args.productId },
        '1.2',
      );
      mode = 'scheduled';
    } else if (scenario === 'upgrade' || scenario === 'new') {
      // The v2 API only takes whole-day durations, so compute the remainder
      // in hours and take the largest whole-day count that never EXTENDS the
      // trial (+1h tolerance because Autumn anchors Stripe-checkout trials a
      // few minutes past the day boundary, e.g. 7d + ~10min). Rounding would
      // let a trial with 2h left become a fresh 24h trial. The one remaining
      // exception is a trial in its final <24h: the API minimum of 1 day
      // still applies there, since the alternative (no trial) would end the
      // trial and bill immediately.
      const remainingHours = (trialEndsAt - Date.now()) / 3_600_000;
      const remainingDays = Math.max(1, Math.floor((remainingHours + 1) / 24));
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
          // Merchant-of-record mode, when enabled. Usually inert: the
          // card is already on file so this branch rarely produces a
          // checkout session at all (see the payment_url note below).
          ...managedPaymentsCheckoutParams(),
        },
        '2.1.0',
      );
      // Card is normally on file (trials are card-required), so no
      // payment redirect is expected. Surface it if Autumn asks anyway.
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

/**
 * First-time paid purchase, routed through Autumn's v2 endpoint.
 *
 * Why this exists at all: Stripe Managed Payments (merchant of record) can only
 * be enabled on the Checkout Session, and the *only* flow in this app that
 * creates one is a customer with no paid plan buying their first subscription.
 * autumn-js's `checkout()` handles that today, but it sends
 * `x-api-version: 1.2`, which routes to Autumn's legacy handler and a Stripe
 * client pinned to `2025-02-24.acacia`, and Stripe refuses Managed Payments on
 * anything before `2025-03-31.basil`. There is no configuration seam: the Convex
 * component takes no API-version option. `POST /billing.attach` (v2.1.0) builds
 * its Stripe client without that pin, so it is the only reachable path.
 *
 * Deliberately scoped to first purchases, and nothing else:
 *
 * - Upgrades/downgrades for an existing payer never create a Checkout Session
 *   (Autumn updates the subscription directly), so they cannot carry Managed
 *   Payments anyway: Stripe cannot convert an existing subscription. They stay
 *   on the legacy path, which keeps `product.scenario` driving the dialog copy
 *   and the pricing-table CTA labels. v2 has no `scenario`; its `attach_action`
 *   collapses renew/active/scheduled and has no `cancel`.
 * - Trialing customers are rejected here and must go through
 *   `switchPlanDuringTrial`, exactly as the `attach` gate in convex/autumn.ts
 *   requires. Its `/checkout` preview is safe on the legacy path precisely
 *   because a trialing customer has a card on file, so Autumn classifies the
 *   call as an upgrade/downgrade and builds no session.
 *
 * Trial policy is re-derived here rather than trusted from the client, mirroring
 * `gateTrialArgs`: eligible customers get the plan's configured trial (pass
 * nothing and Autumn applies it), everyone else gets `customize.free_trial:
 * null`, the v2 spelling of v1.2's `free_trial: false`, which is what stops the
 * cross-plan trial-hopping the gate exists to prevent.
 */
export const attachNewPlan = action({
  args: { productId: v.string() },
  returns: v.object({ paymentUrl: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');
    const customerId = identity.subject;

    // 404 = customer not created in Autumn yet. A brand-new user's very
    // first checkout can run before their Autumn customer exists, and that
    // first purchase is exactly the flow this action owns, so a missing
    // customer means "no plans, no trial history", the same reading
    // gateTrialArgs uses, never an error.
    const customer = await autumnFetch<{
      products?: unknown;
      trials_used?: unknown;
    }>(
      'GET',
      `/customers/${encodeURIComponent(customerId)}?expand=trials_used`,
      undefined,
      '1.2',
      { nullOn404: true },
    );
    const state = getTrialState(customer);
    if (state.onTrial) {
      throw new Error(
        'Plan switches during a trial must go through switchPlanDuringTrial',
      );
    }
    // A customer who already pays would take Autumn's in-place subscription
    // update, which this action's redirect handling isn't built for, and which
    // can't be a Managed Payments sale regardless. Someone who cancelled back to
    // Free has no paid plan and is welcome here, whether or not a card
    // survived (see the redirect_mode note below).
    if (state.hasPaidPlan) {
      throw new Error('Already on a paid plan — use the regular checkout flow');
    }

    const result = await autumnFetch<{ payment_url?: string | null }>(
      'POST',
      '/billing.attach',
      {
        customer_id: customerId,
        plan_id: args.productId,
        // 'always', never 'if_required': 'if_required' bills a saved card
        // directly, WITHOUT a Checkout Session, so a lapsed subscriber
        // whose card survived would be charged on button click with no
        // confirmation step, and (since Managed Payments exists only on the
        // session) would silently buy a non-MoR subscription. 'always'
        // forces every first purchase through Stripe's hosted page (Autumn's
        // setupAttachCheckoutMode: 'always' + paid recurring + no existing
        // subscription → stripe_checkout even with a card on file), which is
        // both the merchant-of-record carrier and the explicit price+tax
        // confirmation.
        redirect_mode: 'always',
        ...(state.trialEligible ? {} : { customize: { free_trial: null } }),
        ...managedPaymentsCheckoutParams(),
      },
      '2.1.0',
    );

    // With redirect_mode 'always' the subscription doesn't exist until the
    // customer returns from Stripe, so this is normally a no-op refresh.
    // Kept because it is harmless and heals the mirror if Autumn ever
    // settles a call inline anyway.
    await syncQuotasForUser(ctx, customerId);

    return { paymentUrl: result?.payment_url ?? null };
  },
});

/**
 * Cancel the delinquent subscription. The "I don't want to pay" exit from
 * the payment-overdue block.
 *
 * Only cancels while genuinely past due, re-derived here from Autumn rather
 * than trusted from the client. Cancels immediately (the org is configured
 * to do this for past-due subscriptions anyway) so the customer lands on
 * Free right away instead of sitting in a cancelled-but-still-overdue limbo.
 * Stripe voids the outstanding invoice as part of that.
 *
 * Outcomes:
 *  - `cancelled`: the plan was past due with an unsettled invoice and was
 *    cancelled immediately.
 *  - `recovered`: nothing needed cancelling. Two ways here: (a) Autumn no
 *    longer reports a past-due plan (payment landed, Stripe's retry
 *    succeeded, or a previous partial run already cancelled), or (b) the
 *    plan still reads past_due but the expanded invoices show NOTHING
 *    unpaid: i.e. the user just paid the hosted invoice and Autumn's
 *    subscription state is lagging the Stripe webhook. Cancelling in that
 *    window would destroy a subscription that was just paid for (the
 *    invoice is settled, so "Stripe voids it" is a no-op and there is no
 *    refund path); invoice status is race-free because Stripe flips it to
 *    `paid` synchronously at payment time. Both branches sync the mirror
 *    first so a stale block clears instead of stranding the user, then
 *    report recovery for the dialog's "payment received" copy.
 *
 * The follow-on sync is what un-blocks the app, and it is also where the
 * course auto-archive in syncAllFeatures finally runs, deliberately
 * suppressed while past due, so it happens here, once, when the plan really
 * has shrunk to Free. That is the archival the dialog warns about.
 */
export const cancelOverdueSubscription = action({
  args: {},
  returns: v.object({
    outcome: v.union(v.literal('cancelled'), v.literal('recovered')),
    cancelledProductId: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');
    const customerId = identity.subject;

    // One fetch carries both signals: the plan list (is anything past due?)
    // and the expanded invoices (has the debt actually been settled?).
    const customer = await autumnFetch<{
      products?: unknown;
      invoices?: AutumnInvoiceEntry[];
    }>(
      'GET',
      `/customers/${encodeURIComponent(customerId)}?expand=invoices`,
      undefined,
      '1.2',
    );

    const overdue = normalizePlans(customer).find(
      (p) => !p.isDefault && !p.isAddOn && p.isPastDue,
    );
    if (!overdue) {
      await syncQuotasForUser(ctx, customerId);
      return { outcome: 'recovered' as const };
    }

    // Cancel-after-pay guard. Only a POSITIVE "invoices expanded and none
    // unpaid" skips the cancel; a missing array is ambiguous (Autumn didn't
    // honor the expand), and there we fail toward the user's explicit
    // request and cancel as before.
    if (Array.isArray(customer.invoices) && !hasUnpaidInvoice(customer)) {
      await syncQuotasForUser(ctx, customerId);
      return { outcome: 'recovered' as const };
    }

    await autumnFetch(
      'POST',
      '/cancel',
      {
        customer_id: customerId,
        product_id: overdue.planId,
        cancel_immediately: true,
      },
      '1.2',
    );

    await syncQuotasForUser(ctx, customerId);

    return {
      outcome: 'cancelled' as const,
      cancelledProductId: overdue.planId,
    };
  },
});

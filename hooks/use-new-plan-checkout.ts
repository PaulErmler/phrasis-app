"use client";

import type { ElementType } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CLIENT_EVENTS, capture } from "@/lib/posthog/events";
import {
  checkoutTrialParams,
  type TrialState,
} from "@/lib/autumn/trial-eligibility";
import { throwOnCheckoutError } from "@/hooks/use-checkout-error";

/**
 * Routes a first paid purchase through Autumn's v2 endpoint
 * (`billing.attachNewPlan`) instead of autumn-js's `checkout()`.
 *
 * Why the legacy path won't do: for a customer without a usable card, the
 * v1.2 `/checkout` preview itself creates the Stripe Checkout Session and
 * autumn-js redirects to it before any dialog opens, and that session is
 * built on a Stripe API version too old for Managed Payments (merchant of
 * record). So first purchases must never reach `checkout()` at all. The v2
 * endpoint builds the session on an unpinned API version and, with
 * `redirect_mode: 'always'`, guarantees EVERY first purchase confirms on
 * Stripe's hosted page, which is also what keeps a lapsed subscriber with
 * a surviving saved card from being charged silently on button click.
 *
 * Everything else. Upgrades, downgrades, cancels, trial switches. Stays on
 * `checkout()` + CheckoutDialog, which keeps `product.scenario` driving the
 * dialog copy and the pricing-table CTA labels.
 *
 * This routing is deterministic from the customer's own state (no server
 * flag, nothing to race), and it is a hint only: the server re-derives every
 * condition in `attachNewPlan` and rejects mismatches, and the legacy
 * `attach`/`checkout` actions refuse first purchases while Managed Payments
 * is on (convex/autumn.ts), so a stale client cannot slip a first purchase
 * past merchant of record.
 */
export function useNewPlanCheckout() {
  const attachNewPlan = useAction(api.billing.attachNewPlan);

  /**
   * True when this purchase must skip `checkout()`: a customer with a paid
   * plan takes an in-place subscription update, and a trialing one must go
   * through `switchPlanDuringTrial`, neither may create a session, and both
   * need the dialog. Everyone else is buying their first subscription.
   */
  const isFirstPurchase = (trialState: TrialState) =>
    !trialState.hasPaidPlan && !trialState.onTrial;

  /**
   * Starts the purchase and hands the user to Stripe's hosted checkout.
   * `redirect_mode: 'always'` server-side means a payment URL is always
   * returned for a valid first purchase; the null branch is defensive.
   */
  const startNewPlanCheckout = async (
    productId: string,
    trialState: TrialState,
  ) => {
    const { paymentUrl } = await attachNewPlan({ productId });
    if (paymentUrl) {
      // Last event observable on our domain. The session (and any replay)
      // resumes as a fresh page load when the customer returns from Stripe.
      capture(CLIENT_EVENTS.CHECKOUT_REDIRECTED, {
        product_id: productId,
        flow: trialState.trialEligible ? "trial_start" : "purchase",
      });
      window.location.href = paymentUrl;
      return { redirected: true as const };
    }
    return { redirected: false as const };
  };

  /**
   * The one purchase entry point shared by the pricing table and the
   * paywall/low-quota dialogs. First purchases go to the v2 hosted
   * checkout, never `checkout()`, whose legacy preview can't carry
   * Managed Payments; everyone else opens CheckoutDialog via `checkout()`,
   * with autumn-js's `{ error }` containers surfaced as throws (a plain
   * await "succeeds" silently on failure).
   */
  const purchasePlan = async ({
    productId,
    trialState,
    checkout,
    dialog,
    freeTarget = false,
  }: {
    productId: string;
    trialState: TrialState;
    /** The caller's `useCustomer().checkout`. */
    checkout: (params: {
      productId: string;
      dialog?: ElementType;
      freeTrial?: false;
    }) => Promise<unknown>;
    dialog: ElementType;
    /**
     * True when the clicked product is the Free plan. A cancel/downgrade,
     * never a purchase, so it always goes through `checkout()` + the dialog
     * (the v2 route only sells paid plans).
     */
    freeTarget?: boolean;
  }) => {
    if (!freeTarget && isFirstPurchase(trialState)) {
      await startNewPlanCheckout(productId, trialState);
    } else {
      throwOnCheckoutError(
        await checkout({
          productId,
          dialog,
          ...checkoutTrialParams(trialState),
        }),
      );
    }
  };

  return { isFirstPurchase, startNewPlanCheckout, purchasePlan };
}

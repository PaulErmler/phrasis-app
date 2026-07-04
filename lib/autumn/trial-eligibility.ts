/**
 * Minimal subset of Autumn's CustomerProduct that trial gating needs.
 * Avoids depending on the (non-exported) full CustomerProduct type;
 * the fields here match what `useCustomer().customer.products[number]`
 * ships. `is_default: true` is Autumn's auto-assigned free plan that
 * every customer has — it never counts as a subscription.
 */
export type CustomerProductLite = {
  id: string;
  status: string;
  is_default: boolean;
  is_add_on: boolean;
  /** Autumn's legacy (v1.2) customer shape leaves this null while
   *  trialing and reports the trial end via `current_period_end`. */
  trial_ends_at?: number | null;
  current_period_end?: number | null;
};

/**
 * One consumed-trial record from `expand: ["trials_used"]`. Includes
 * trials that are still running. The legacy (v1.2) API names the plan
 * field `product_id`; newer API versions call it `plan_id`.
 */
export type TrialUsedLite = {
  product_id?: string;
  plan_id?: string;
};

export type TrialState = {
  /** Has consumed a trial at some point — including one running now. */
  everTrialed: boolean;
  /** Is currently trialing a paid plan. */
  onTrial: boolean;
  /** Trial end in ms. Only set while `onTrial`. */
  trialEndsAt: number | undefined;
  /** Currently has any non-default, non-add-on product attached. */
  hasPaidPlan: boolean;
  /** May start a fresh trial: never trialed AND not on a paid plan. */
  trialEligible: boolean;
};

/**
 * Whether the user currently has any paid plan attached — including one
 * they are still trialing. Add-ons (`is_add_on`) are bolt-on usage
 * products, not subscriptions.
 */
export function hasPaidPlanHistory(
  products: CustomerProductLite[] | null | undefined,
): boolean {
  return (products ?? []).some((cp) => !cp.is_default && !cp.is_add_on);
}

/**
 * Derives the trial state from an Autumn customer fetched with
 * `expand: ["trials_used"]`.
 *
 * Autumn's built-in trial dedup only blocks re-trialing the SAME plan, so
 * without our own gating a customer could hop basic → pro → basic_annual →
 * pro_annual and collect a fresh 7-day trial each time. The policy here:
 *
 * - A trial can only ever start for a user who has never had one on any
 *   plan (`trials_used` is the durable record — it survives cancellations,
 *   unlike `customer.products`, which only lists current products).
 * - A currently-trialing user switching plans keeps their running trial
 *   (see `switchPlanDuringTrial` in convex/billing.ts) — they are neither
 *   offered a fresh trial nor billed early.
 * - Everyone else attaches with `freeTrial: false` (see
 *   `checkoutTrialParams`).
 */
export function getTrialState(
  customer:
    | {
        products?: unknown;
        trials_used?: unknown;
      }
    | null
    | undefined,
): TrialState {
  const products = (customer?.products ?? []) as CustomerProductLite[];
  const trialsUsed = (customer?.trials_used ?? []) as TrialUsedLite[];

  const trialing = products.find(
    (cp) => !cp.is_default && !cp.is_add_on && cp.status === "trialing",
  );
  const hasPaidPlan = hasPaidPlanHistory(products);
  // A running trial also implies "trialed" — fallback for customers
  // fetched without the trials_used expand.
  const everTrialed = trialsUsed.length > 0 || trialing !== undefined;

  return {
    everTrialed,
    onTrial: trialing !== undefined,
    trialEndsAt:
      trialing?.trial_ends_at ?? trialing?.current_period_end ?? undefined,
    hasPaidPlan,
    trialEligible: !everTrialed && !hasPaidPlan,
  };
}

/**
 * Trial params to spread into autumn-js `checkout()` / `attach()` calls.
 *
 * - Trial-eligible users pass nothing: Autumn starts the plan's trial.
 * - Currently-trialing users pass nothing: `freeTrial: false` would end
 *   their trial and bill immediately on confirm. Their plan switches are
 *   routed through `switchPlanDuringTrial` instead, which continues the
 *   running trial; leaving the preview untouched here is safe because the
 *   dialog overrides copy and amounts for trialing users.
 * - Everyone else (paying now, or trialed/paid in the past) gets
 *   `freeTrial: false`, which Autumn's `/checkout` and `/attach` both
 *   honor — the preview then shows real charges instead of a phantom
 *   cross-plan trial.
 */
export function checkoutTrialParams(state: TrialState): { freeTrial?: false } {
  return !state.trialEligible && !state.onTrial ? { freeTrial: false } : {};
}

import {
  currentPlans,
  findCurrentPaidPlan,
  normalizePlans,
  type AutumnCustomerLike,
  type AutumnPlan,
} from './customer-shape';

/**
 * One consumed-trial record from `expand: ["trials_used"]`. Includes
 * trials that are still running. Only the count is ever used — the legacy
 * (v1.2) API names the plan field `product_id` and newer versions call it
 * `plan_id`, and we deliberately depend on neither.
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
 * The paid plan the customer is currently on. Accepts the raw plan array
 * from either Autumn API family; see lib/autumn/customer-shape.ts.
 */
export function findCurrentPaidProduct(
  products: unknown,
): AutumnPlan | undefined {
  return findCurrentPaidPlan(normalizePlans({ products }));
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
  customer: (AutumnCustomerLike & { trials_used?: unknown }) | null | undefined,
): TrialState {
  // Only plans held RIGHT NOW: an `expired` entry (a lapsed trial or a
  // fully executed cancel can leave one in the payload) must not read as a
  // paid plan — that misrouted lapsed customers off the first-purchase
  // path — and a trial cancelled early leaves an expired entry whose
  // trial_ends_at is still in the future, which must not read as onTrial.
  // A `scheduled` entry is a pending change, not a held plan.
  const plans = currentPlans(normalizePlans(customer));
  const trialsUsed = (customer?.trials_used ?? []) as TrialUsedLite[];

  const trialing = plans.find(
    (p) => !p.isDefault && !p.isAddOn && p.isTrialing,
  );
  // Add-ons are bolt-on usage products, not subscriptions.
  const hasPaidPlan = plans.some((p) => !p.isDefault && !p.isAddOn);
  // A running trial also implies "trialed" — fallback for customers
  // fetched without the trials_used expand.
  const everTrialed = trialsUsed.length > 0 || trialing !== undefined;

  return {
    everTrialed,
    onTrial: trialing !== undefined,
    trialEndsAt: trialing?.trialEndsAt,
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
 *   `freeTrial: false`. On `/checkout` previews this still works (probed
 *   2026-08-09). On the legacy `/attach` it no longer does — Autumn's
 *   v1.2→v2 translation silently loses the boolean and `null` fails its
 *   schema, so the server routes these attaches through v2
 *   `/billing.attach` with `customize.free_trial: null` instead (see
 *   attachViaV2NoTrial in convex/autumn.ts). The flag here doubles as that
 *   routing signal.
 */
export function checkoutTrialParams(state: TrialState): { freeTrial?: false } {
  return !state.trialEligible && !state.onTrial ? { freeTrial: false } : {};
}

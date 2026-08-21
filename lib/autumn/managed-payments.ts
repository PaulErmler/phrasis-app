/**
 * Stripe Managed Payments. Stripe's merchant-of-record mode.
 *
 * With it enabled, Stripe (not Flexling) is the seller of record on the
 * checkout: it calculates, charges, and remits indirect tax in 80+
 * countries, and owns fraud, disputes, and transaction-level support.
 * Autumn has no first-class support for it; the only activation path is to
 * forward `managed_payments` onto the Stripe Checkout Session Autumn
 * creates, via `checkout_session_params`.
 *
 * Three things about that passthrough are load-bearing and non-obvious:
 *
 * 1. **Only the v2 `/billing.attach` REST calls in convex/billing.ts may
 *    carry this.** The autumn-js/component path pins `x-api-version: 1.2`,
 *    whose handler builds its Stripe client on 2025-02-24.acacia: and
 *    Stripe rejects `managed_payments` before 2025-03-31.basil. The bodies
 *    in convex/billing.ts are hand-written snake_case for the REST API;
 *    nothing case-converts them, so the keys below MUST stay snake_case or
 *    Stripe rejects the session.
 * 2. **Autumn's own session params win the merge.** Server-side Autumn does
 *    `{...checkout_session_params, ...params}`, so anything Autumn sets
 *    itself overrides us. That is fine for `managed_payments` (Autumn never
 *    sets it), but it means Autumn's org-level automatic tax: which bakes
 *    in `automatic_tax`, `tax_id_collection`, and `customer_update`, all
 *    forbidden under Managed Payments: must be turned OFF in the Autumn
 *    dashboard or Stripe rejects the session.
 * 3. **It only ever applies to purchases that go through Stripe Checkout.**
 *    Stripe cannot convert existing subscriptions, and Autumn skips Checkout
 *    entirely when the customer already has a usable card (upgrades and
 *    downgrades become direct subscription updates). That is why
 *    `attachNewPlan` forces `redirect_mode: 'always'` while the flag is on:
 *    'if_required' would bill a lapsed subscriber's surviving card directly
 *    and silently create a non-MoR subscription. A mixed estate of MoR
 *    (bought after the flag) and non-MoR (before) subscriptions is still
 *    the expected steady state.
 */

/**
 * The Stripe Checkout Session payload that turns Managed Payments on.
 * Snake_case is deliberate. See (1) above.
 */
export const MANAGED_PAYMENTS_SESSION_PARAMS = {
  managed_payments: { enabled: true },
} as const;

/**
 * Whether the Managed Payments rollout flag is on for this deployment.
 * Read per call rather than at module load so `npx convex env set/unset
 * AUTUMN_MANAGED_PAYMENTS` takes effect without waiting on isolate
 * recycling. Server-only (convex/), the env var is not a NEXT_PUBLIC one.
 */
export function managedPaymentsEnabled(): boolean {
  return process.env.AUTUMN_MANAGED_PAYMENTS === 'true';
}

/**
 * The `checkout_session_params` spread for every v2 attach body. One shared
 * helper so a future call site cannot forget the flag check and silently
 * sell without merchant of record.
 */
export function managedPaymentsCheckoutParams():
  | { checkout_session_params: typeof MANAGED_PAYMENTS_SESSION_PARAMS }
  | Record<string, never> {
  return managedPaymentsEnabled()
    ? { checkout_session_params: MANAGED_PAYMENTS_SESSION_PARAMS }
    : {};
}

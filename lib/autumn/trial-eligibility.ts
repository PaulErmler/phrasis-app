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
};

/**
 * Whether the user has (or had) any paid plan attached — including one
 * they are currently trialing.
 *
 * Autumn's built-in trial dedup only blocks re-trialing the SAME plan, so
 * without this a Pro customer (or Pro-trial customer) would still be
 * offered a fresh trial on Basic or on the annual variants. Every
 * `checkout()`/`attach()` call passes `freeTrial: false` when this is
 * true, and the pricing UI hides trial badges/copy.
 *
 * Trialing subscriptions count on purpose: someone already on a plan must
 * never see "Start Free Trial" on another plan (no trial-stacking, no
 * trial reset by hopping between monthly and annual variants). Add-ons
 * (`is_add_on`) are bolt-on usage products, not subscriptions.
 */
export function hasPaidPlanHistory(
  products: CustomerProductLite[] | null | undefined,
): boolean {
  return (products ?? []).some((cp) => !cp.is_default && !cp.is_add_on);
}

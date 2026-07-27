import type { Product } from "autumn-js";
import { CREDIT_COSTS, FEATURE_IDS, type FeatureId } from "@/convex/features/featureIds";
import {
  findCurrentPaidPlan,
  normalizePlans,
  type AutumnCustomerLike,
} from "@/lib/autumn/customer-shape";

/**
 * Credit-consuming features are granted via the shared `credits` item on
 * current plans, so product lookups must search for (and compare against)
 * credits rather than the underlying feature. `included` arrives in feature
 * units (see useFeatureQuota) and is converted back into credits.
 */
export function toBillableFeature(
  featureId: string,
  included: number,
): { featureId: string; included: number } {
  const creditCost = CREDIT_COSTS[featureId as FeatureId];
  if (creditCost === undefined) return { featureId, included };
  return { featureId: FEATURE_IDS.CREDITS, included: included * creditCost };
}

/** Monthly/annual list price of a plan, used to order upgrade candidates. */
function productPrice(product: Product): number {
  const price = product.items[0]?.price;
  return typeof price === "number" ? price : 0;
}

/**
 * The billing interval the customer already pays on (`"month"` / `"year"`),
 * or undefined when they hold no paid plan. Autumn reports the interval on the
 * pricing-table product, not on the customer record, so the two are joined by
 * plan id.
 */
export function findCurrentIntervalGroup(
  customer: AutumnCustomerLike | null | undefined,
  products: Product[] | undefined,
): string | undefined {
  const currentPaid = findCurrentPaidPlan(normalizePlans(customer));
  if (!currentPaid) return undefined;
  return products?.find((p) => p.id === currentPaid.planId)?.properties
    ?.interval_group;
}

/**
 * Narrow upgrade candidates to the customer's own billing interval, so an
 * annual subscriber is offered Ultra Annual rather than monthly Ultra just
 * because €32 sorts below €288.
 *
 * Falls back to the full list when nothing in that interval qualifies —
 * a cross-interval upgrade beats telling the user to contact support. With no
 * paid plan there is no interval to honour, and the caller's price ordering
 * then picks the monthly plan, which is the smaller first commitment.
 */
export function preferIntervalGroup<
  T extends { properties?: { interval_group?: string | null } | null },
>(products: T[], intervalGroup: string | undefined): T[] {
  if (!intervalGroup) return products;
  const sameInterval = products.filter(
    (p) => p.properties?.interval_group === intervalGroup,
  );
  return sameInterval.length > 0 ? sameInterval : products;
}

/**
 * Finds the CHEAPEST pricing-table product that increases entitlement for `featureId`
 * beyond `included`. Used when `usePaywall()` only suggests a tier that does not
 * actually raise the limit (e.g. Free→Basic for courses, both grant 1 active course).
 *
 * Callers pass products in Autumn's dashboard order, which is not price-sorted. With
 * three paid tiers that would point a Basic user who ran out of credits at Ultra when
 * Pro would have done, so candidates are sorted by price before picking — after being
 * narrowed to the customer's own billing interval (`preferredIntervalGroup`).
 *
 * Eligible rows: paid plans (`!is_free` — you never "upgrade" to Free, whatever
 * scenario Autumn reports) with scenario `"upgrade"` or `"new"`.
 * Boolean features (`consumable === undefined`): any product that includes the feature item.
 */
export function findUpgradeProductFromPricingTable(
  products: Product[] | undefined,
  featureId: string,
  included: number,
  consumable?: boolean,
  preferredIntervalGroup?: string,
): Product | undefined {
  const billable = toBillableFeature(featureId, included);
  // Eligibility is decided before the interval is honoured: narrowing first
  // would hide a qualifying monthly plan from an annual subscriber whose own
  // interval has nothing to offer, leaving them with no upgrade at all.
  const eligible = (products ?? []).filter((p) => {
    if (p.properties?.is_free) return false;
    if (p.scenario !== "upgrade" && p.scenario !== "new") return false;
    const featureItem = p.items.find((i) => i.feature_id === billable.featureId);
    if (!featureItem) return false;
    if (consumable === undefined) return true;
    if (featureItem.included_usage === "inf") return true;
    return (
      typeof featureItem.included_usage === "number" &&
      featureItem.included_usage > billable.included
    );
  });
  return preferIntervalGroup(eligible, preferredIntervalGroup).sort(
    (a, b) => productPrice(a) - productPrice(b),
  )[0];
}

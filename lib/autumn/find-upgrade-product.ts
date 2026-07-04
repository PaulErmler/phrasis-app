import type { Product } from "autumn-js";
import { CREDIT_COSTS, FEATURE_IDS, type FeatureId } from "@/convex/features/featureIds";

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

/**
 * Finds the first pricing-table product that increases entitlement for `featureId`
 * beyond `included`. Used when `usePaywall()` only suggests a tier that does not
 * actually raise the limit (e.g. Free→Basic for courses, both grant 1 active course).
 *
 * Eligible rows: `scenario === "upgrade"` or a paid `new` subscription (`!is_free`).
 * Boolean features (`consumable === undefined`): any product that includes the feature item.
 */
export function findUpgradeProductFromPricingTable(
  products: Product[] | undefined,
  featureId: string,
  included: number,
  consumable?: boolean,
): Product | undefined {
  const billable = toBillableFeature(featureId, included);
  return products?.find((p) => {
    if (p.scenario !== "upgrade" && !(p.scenario === "new" && !p.properties?.is_free)) {
      return false;
    }
    const featureItem = p.items.find((i) => i.feature_id === billable.featureId);
    if (!featureItem) return false;
    if (consumable === undefined) return true;
    if (featureItem.included_usage === "inf") return true;
    return (
      typeof featureItem.included_usage === "number" &&
      featureItem.included_usage > billable.included
    );
  });
}

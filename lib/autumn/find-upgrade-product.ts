import type { Product } from "autumn-js";

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
  return products?.find((p) => {
    if (p.scenario !== "upgrade" && !(p.scenario === "new" && !p.properties?.is_free)) {
      return false;
    }
    const featureItem = p.items.find((i) => i.feature_id === featureId);
    if (!featureItem) return false;
    if (consumable === undefined) return true;
    if (featureItem.included_usage === "inf") return true;
    return (
      typeof featureItem.included_usage === "number" &&
      featureItem.included_usage > included
    );
  });
}

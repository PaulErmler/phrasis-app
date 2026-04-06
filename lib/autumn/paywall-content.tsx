import { type CheckFeaturePreview, type Product } from "autumn-js";

/**
 * Filters Autumn upgrade products to only those that actually increase the
 * quota for `featureId` beyond `currentIncluded`. This prevents recommending
 * a plan that has the same (or lower) limit for the feature in question.
 *
 * For boolean / non-metered features (`consumable === undefined`), Convex
 * `included` often reflects a display cap (e.g. 2 languages) while Autumn
 * product items use `included_usage: 1` for the flag — numeric compare would
 * incorrectly drop every product. Those features only require the item to exist.
 */
export function filterProductsByFeatureIncrease(
  products: Product[],
  featureId: string,
  currentIncluded: number,
  consumable?: boolean,
): Product[] {
  return products.filter((product) => {
    const featureItem = product.items.find((i) => i.feature_id === featureId);
    if (!featureItem) return false;
    if (consumable === undefined) return true;
    if (featureItem.included_usage === "inf") return true;
    return (
      typeof featureItem.included_usage === "number" &&
      featureItem.included_usage > currentIncluded
    );
  });
}

export type PaywallTranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

/** Pick the right title based on Autumn preview scenario + product type. */
export function getPaywallTitle(
  preview: CheckFeaturePreview,
  t: PaywallTranslateFn,
): string {
  const { products } = preview;
  if (products.length === 0) return t("featureUnavailable");

  const nextProduct = products[0];
  return nextProduct.free_trial
    ? t("startTrial", { productName: nextProduct.name })
    : nextProduct.is_add_on
      ? t("purchaseAddOn", { productName: nextProduct.name })
      : t("upgradeTo", { productName: nextProduct.name });
}

/** Pick the right message body based on Autumn preview scenario. */
export function getPaywallMessage(
  preview: CheckFeaturePreview,
  t: PaywallTranslateFn,
  featureName: string,
  consumable?: boolean,
): string {
  const { scenario, products } = preview;

  if (products.length === 0) {
    if (scenario === "usage_limit") {
      return t(
        consumable === false ? "capReachedNoProducts" : "usageLimitNoProducts",
        { featureName },
      );
    }
    return t("notAvailableContactUs");
  }

  const nextProduct = products[0];
  const isAddOn = nextProduct.is_add_on;

  const upgradeDetailKey = (() => {
    switch (scenario) {
    case "usage_limit":
      return consumable === false ? "upgradeDetailCap" : "upgradeDetailUsageLimit";
    case "feature_flag":
    default:
      return "upgradeDetail";
    }
  })();

  const detail = isAddOn
    ? t("addOnDetail", { productName: nextProduct.name, featureName })
    : t(upgradeDetailKey, { productName: nextProduct.name, featureName });

  switch (scenario) {
  case "usage_limit":
    return t(
      consumable === false ? "capReachedWithDetail" : "usageLimitWithDetail",
      { featureName, detail },
    );
  case "feature_flag":
    return t("featureFlagWithDetail", { featureName, detail });
  default:
    return t("notAvailableForAccount");
  }
}

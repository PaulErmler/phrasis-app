import { type CheckFeaturePreview } from "autumn-js";

export type PaywallTranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

/**
 * Generates title + message for the paywall dialog.
 * @param preview - Autumn's feature check preview (may be undefined)
 * @param t - translation function scoped to the "Paywall" namespace
 * @param featureName - the already-translated feature display name
 * @param consumable - whether the feature resets periodically (true) or is a permanent cap (false)
 */
export const getPaywallContent = (
  preview: CheckFeaturePreview | undefined,
  t: PaywallTranslateFn,
  featureName: string,
  consumable?: boolean
) => {
  const usageLimitKey = consumable === false
    ? "capReached"
    : "usageLimitReached";

  const usageLimitWithDetailKey = consumable === false
    ? "capReachedWithDetail"
    : "usageLimitWithDetail";

  if (!preview) {
    return {
      title: t("featureUnavailable"),
      message: t("notAvailableForAccount"),
    };
  }

  const { scenario, products } = preview;

  if (products.length === 0) {
    switch (scenario) {
      case "usage_limit":
        return {
          title: t("featureUnavailable"),
          message: t(
            consumable === false ? "capReachedNoProducts" : "usageLimitNoProducts",
            { featureName }
          ),
        };
      default:
        return {
          title: t("featureUnavailable"),
          message: t("notAvailableContactUs"),
        };
    }
  }

  const nextProduct = products[0];
  const isAddOn = nextProduct && nextProduct.is_add_on;

  const title = nextProduct.free_trial
    ? t("startTrial", { productName: nextProduct.name })
    : nextProduct.is_add_on
      ? t("purchaseAddOn", { productName: nextProduct.name })
      : t("upgradeTo", { productName: nextProduct.name });

  const detail = isAddOn
    ? t("addOnDetail", {
        productName: nextProduct.name,
        featureName,
      })
    : t("upgradeDetail", {
        productName: nextProduct.name,
        featureName,
      });

  switch (scenario) {
    case "usage_limit":
      return {
        title,
        message: t(usageLimitWithDetailKey, {
          featureName,
          detail,
        }),
      };
    case "feature_flag":
      return {
        title,
        message: t("featureFlagWithDetail", {
          featureName,
          detail,
        }),
      };
    default:
      return {
        title: t("featureUnavailable"),
        message: t("notAvailableForAccount"),
      };
  }
};

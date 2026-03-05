import { type CheckFeaturePreview } from "autumn-js";

export type PaywallTranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export const getPaywallContent = (
  preview: CheckFeaturePreview | undefined,
  t: PaywallTranslateFn
) => {
  if (!preview) {
    return {
      title: t("featureUnavailable"),
      message: t("notAvailableForAccount"),
    };
  }

  const { scenario, products, feature_name } = preview;

  if (products.length == 0) {
    switch (scenario) {
      case "usage_limit":
        return {
          title: t("featureUnavailable"),
          message: t("usageLimitNoProducts", { featureName: feature_name }),
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
        featureName: feature_name,
      })
    : t("upgradeDetail", {
        productName: nextProduct.name,
        featureName: feature_name,
      });

  switch (scenario) {
    case "usage_limit":
      return {
        title,
        message: t("usageLimitWithDetail", {
          featureName: feature_name,
          detail,
        }),
      };
    case "feature_flag":
      return {
        title,
        message: t("featureFlagWithDetail", { detail }),
      };
    default:
      return {
        title: t("featureUnavailable"),
        message: t("notAvailableForAccount"),
      };
  }
};

import { type Product } from "autumn-js";

export type PricingTranslateFn = (key: string) => string;

export const getPricingTableContent = (
  product: Product,
  t: PricingTranslateFn,
  userHasNonTrialSubscription: boolean,
) => {
  const { scenario, properties } = product;
  const { is_one_off, updateable, has_trial } = properties;

  // Mirrors the badge gating in components/autumn/pricing-table.tsx:
  // show "Start free trial" only when the viewer can actually start one
  // — the product offers a trial, this card isn't their current plan
  // (Autumn returns "new" for users with no plan record, "upgrade" for
  // users on the auto-default free tier), and the viewer has no
  // committed paid plan (trial entries don't count, so trial-stacking
  // stays open).
  const canStartTrial =
    has_trial &&
    (scenario === "new" || scenario === "upgrade") &&
    !userHasNonTrialSubscription;

  if (canStartTrial) {
    return {
      buttonText: t("startFreeTrial"),
    };
  }

  switch (scenario) {
  case "scheduled":
    return {
      buttonText: t("planScheduled"),
    };

  case "active":
    if (updateable) {
      return {
        buttonText: t("updatePlan"),
      };
    }

    return {
      buttonText: t("currentPlan"),
    };

  case "new":
    if (is_one_off) {
      return {
        buttonText: t("purchase"),
      };
    }

    return {
      buttonText: t("getStarted"),
    };

  case "renew":
    return {
      buttonText: t("renew"),
    };

  case "upgrade":
    return {
      buttonText: t("upgrade"),
    };

  case "downgrade":
    return {
      buttonText: t("downgrade"),
    };

  case "cancel":
    return {
      buttonText: t("cancelPlan"),
    };

  default:
    return {
      buttonText: t("getStartedDefault"),
    };
  }
};

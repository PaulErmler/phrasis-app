import { type Product } from "autumn-js";

export type PricingTranslateFn = (key: string) => string;

export const getPricingTableContent = (
  product: Product,
  t: PricingTranslateFn,
  trialEligible: boolean,
) => {
  const { scenario, properties } = product;
  const { is_one_off, updateable, has_trial } = properties;

  // Mirrors the badge gating in components/autumn/pricing-table.tsx:
  // show "Start free trial" only when the viewer can actually start one
  // The product offers a trial, this card isn't their current plan
  // (Autumn returns "new" for users with no plan record, "upgrade" for
  // users on the auto-default free tier), and the viewer is
  // trial-eligible (never trialed any plan and not on a paid plan; see
  // lib/autumn/trial-eligibility.ts).
  const canStartTrial =
    has_trial &&
    (scenario === "new" || scenario === "upgrade") &&
    trialEligible;

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

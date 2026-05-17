import { type Product } from "autumn-js";

export type PricingTranslateFn = (key: string) => string;

export const getPricingTableContent = (
  product: Product,
  t: PricingTranslateFn
) => {
  const { scenario, properties } = product;
  const { is_one_off, updateable, has_trial } = properties;

  // "Start free trial" applies only when the user can fresh-subscribe to
  // this product (`scenario === 'new'`). Without this scenario check, a
  // user already on Basic or Pro would see "Start free trial" on the card
  // for their (or any) plan; Autumn instead surfaces a scenario like
  // "active" / "upgrade" / "downgrade" in those cases, which the switch
  // below maps to the correct CTA.
  if (has_trial && scenario === "new") {
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

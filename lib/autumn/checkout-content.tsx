import { type CheckoutResult } from "autumn-js";

export type CheckoutTranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export const getCheckoutContent = (
  checkoutResult: CheckoutResult,
  t: CheckoutTranslateFn
) => {
  const { product, current_product, next_cycle } = checkoutResult;
  const { is_one_off, is_free, has_trial, updateable } = product.properties;
  const scenario = product.scenario;

  const nextCycleAtStr = next_cycle
    ? new Date(next_cycle.starts_at).toLocaleDateString()
    : undefined;

  const productName = product.name;

  if (is_one_off) {
    return {
      title: t("purchaseTitle", { productName }),
      message: t("purchaseMessage", { productName }),
    };
  }

  if (scenario === "active" && updateable) {
    return {
      title: t("updatePlanTitle"),
      message: t("updatePlanMessage"),
    };
  }

  if (has_trial) {
    return {
      title: t("startTrialTitle", { productName }),
      message: t("startTrialMessage", {
        productName,
        date: nextCycleAtStr ?? "",
      }),
    };
  }

  switch (scenario) {
    case "scheduled":
      return {
        title: t("scheduledTitle", { productName }),
        message: t("scheduledMessage", {
          productName,
          currentProduct: current_product.name,
          date: nextCycleAtStr ?? "",
        }),
      };

    case "active":
      return {
        title: t("alreadyActiveTitle"),
        message: t("alreadyActiveMessage"),
      };

    case "new":
      if (is_free) {
        return {
          title: t("enableTitle", { productName }),
          message: t("enableMessage", { productName }),
        };
      }
      return {
        title: t("subscribeTitle", { productName }),
        message: t("subscribeMessage", { productName }),
      };

    case "renew":
      return {
        title: t("renewTitle"),
        message: t("renewMessage", { productName }),
      };

    case "upgrade":
      return {
        title: t("upgradeTitle", { productName }),
        message: t("upgradeMessage", { productName }),
      };

    case "downgrade":
      return {
        title: t("downgradeTitle", { productName }),
        message: t("downgradeMessage", {
          productName,
          currentProduct: current_product.name,
          date: nextCycleAtStr ?? "",
        }),
      };

    case "cancel":
      return {
        title: t("cancelTitle"),
        message: t("cancelMessage", {
          currentProduct: current_product.name,
          date: nextCycleAtStr ?? "",
        }),
      };

    default:
      return {
        title: t("changeTitle"),
        message: t("changeMessage"),
      };
  }
};

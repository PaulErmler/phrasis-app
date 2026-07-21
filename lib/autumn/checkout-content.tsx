import { type CheckoutResult } from "autumn-js";
import { type TrialState } from "@/lib/autumn/trial-eligibility";

export type CheckoutTranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export const getCheckoutContent = (
  checkoutResult: CheckoutResult,
  t: CheckoutTranslateFn,
  trialState: TrialState,
  opts?: {
    /**
     * The customer's own `current_period_end`. Scenarios that take effect
     * at the end of the current period (cancel / downgrade / scheduled)
     * prefer this over the preview's `next_cycle.starts_at`: Autumn's
     * v1.2 checkout preview returns the period START for annual plans —
     * exactly one year early (verified July 2026) — while the customer
     * record carries the correct end.
     */
    currentPeriodEndsAt?: number;
    /** App locale for date formatting; falls back to the browser default. */
    locale?: string;
  }
) => {
  const { product, current_product, next_cycle } = checkoutResult;
  const { is_one_off, is_free, has_trial, updateable } = product.properties;
  const scenario = product.scenario;

  const formatDate = (ms: number) =>
    new Date(ms).toLocaleDateString(opts?.locale);

  const nextCycleAtStr = next_cycle
    ? formatDate(next_cycle.starts_at)
    : undefined;

  // Effective date for period-end-anchored scenarios (see opts doc).
  const periodEndAtStr =
    opts?.currentPeriodEndsAt !== undefined
      ? formatDate(opts.currentPeriodEndsAt)
      : nextCycleAtStr;

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

  // Currently-trialing user switching plans: the running trial is kept
  // (see convex/billing.ts switchPlanDuringTrial), so the copy must not
  // promise a fresh trial or an immediate charge. The date comes from the
  // customer's own trial end — the preview's next_cycle can reflect a
  // phantom fresh trial. Downgrades — including to the Free plan, which
  // Autumn classifies as "downgrade" or "cancel" — are scheduled at trial
  // end; everything else switches now with the trial carried over. Must
  // mirror the scenarios accepted by checkout-dialog.tsx isTrialSwitch.
  if (
    trialState.onTrial &&
    (is_free
      ? scenario === "downgrade" || scenario === "cancel"
      : scenario === "upgrade" || scenario === "downgrade" || scenario === "new")
  ) {
    const trialEndStr = trialState.trialEndsAt
      ? formatDate(trialState.trialEndsAt)
      : (nextCycleAtStr ?? "");
    const key = is_free
      ? "trialFreeScheduled"
      : scenario === "downgrade"
        ? "trialContinueScheduled"
        : "trialContinueSwitchNow";
    return {
      title: t(`${key}Title`, { productName }),
      message: t(`${key}Message`, { productName, date: trialEndStr }),
    };
  }

  // Only trial-eligible users get trial copy. For everyone else the
  // checkout preview was requested with `freeTrial: false`, so has_trial
  // should already be false — this gate is the safety net for previews
  // opened without it (falls through to the scenario copy below).
  if (has_trial && trialState.trialEligible) {
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
        date: periodEndAtStr ?? "",
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
        date: periodEndAtStr ?? "",
      }),
    };

  case "cancel":
    return {
      title: t("cancelTitle"),
      message: t("cancelMessage", {
        currentProduct: current_product.name,
        date: periodEndAtStr ?? "",
      }),
    };

  default:
    return {
      title: t("changeTitle"),
      message: t("changeMessage"),
    };
  }
};

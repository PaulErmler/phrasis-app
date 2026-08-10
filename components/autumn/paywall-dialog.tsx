"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePaywall, useCustomer, usePricingTable } from "autumn-js/react";
import {
  findCurrentIntervalGroup,
  findUpgradeProductFromPricingTable,
  preferIntervalGroup,
} from "@/lib/autumn/find-upgrade-product";
import { checkoutTrialParams, getTrialState } from "@/lib/autumn/trial-eligibility";
import { getPaywallTitle, getPaywallMessage, filterProductsByFeatureIncrease } from "@/lib/autumn/paywall-content";
import { getFeatureI18nKey, isFeatureConsumable, getFeaturePaywallKey } from "@/lib/features/feature-meta";
import { isCreditBackedFeature } from "@/convex/features/featureIds";
import { useFeatureQuota } from "@/components/feature_tracking/useFeatureQuota";
import { usePaywallImpression } from "@/lib/posthog/use-impression";
import { cn } from "@/lib/utils";
import CheckoutDialog from "@/components/autumn/checkout-dialog";
import UsageLimitDialog from "@/components/autumn/usage-limit-dialog";
import { useIsNativeApp } from "@/hooks/use-native-app";
import { useNewPlanCheckout } from "@/hooks/use-new-plan-checkout";
import {
  throwOnCheckoutError,
  useCheckoutErrorToast,
} from "@/hooks/use-checkout-error";

export interface PaywallDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  featureId: string;
  entityId?: string;
}

/**
 * Store builds must not show upgrade prompts or prices, so the shell gets the
 * neutral limit-reached dialog (contact support) instead of the paywall.
 */
export default function PaywallDialog(params?: PaywallDialogProps) {
  const isNative = useIsNativeApp();
  if (!params) return <></>;
  if (isNative) {
    return (
      <UsageLimitDialog
        open={params.open}
        setOpen={params.setOpen}
        featureId={params.featureId}
      />
    );
  }
  return <PaywallDialogInner {...params} />;
}

function PaywallDialogInner(params?: PaywallDialogProps) {
  const t = useTranslations("Paywall");
  const tFeatures = useTranslations("Features");
  const { data: preview, isLoading } = usePaywall({
    featureId: params?.featureId,
    entityId: params?.entityId,
  });
  const { products: pricingTableProducts } = usePricingTable();
  const { checkout, customer } = useCustomer({ expand: ["trials_used"] });
  const trialState = getTrialState(customer);
  const { isFirstPurchase, startNewPlanCheckout } = useNewPlanCheckout();
  const showCheckoutError = useCheckoutErrorToast();
  const [upgrading, setUpgrading] = useState(false);
  const filterFeatureId = params?.featureId ?? "";
  const consumable = isFeatureConsumable(filterFeatureId);
  const { balance, included, used } = useFeatureQuota(filterFeatureId);

  // Both suggestion paths are narrowed to the interval the customer already
  // pays on, so an annual subscriber is never sent to a monthly plan.
  const intervalGroup = findCurrentIntervalGroup(
    customer,
    pricingTableProducts ?? undefined,
  );

  const relevantProducts = useMemo(() => {
    const filtered = filterProductsByFeatureIncrease(
      preview?.products ?? [],
      filterFeatureId,
      included,
      consumable,
    );
    if (filtered.length > 0) return preferIntervalGroup(filtered, intervalGroup);
    const fallback = findUpgradeProductFromPricingTable(
      pricingTableProducts ?? undefined,
      filterFeatureId,
      included,
      consumable,
      intervalGroup,
    );
    return fallback ? [fallback] : [];
  }, [
    preview?.products,
    pricingTableProducts,
    filterFeatureId,
    included,
    consumable,
    intervalGroup,
  ]);

  // Top of the upgrade funnel. Above the early return because hooks must run in
  // the same order every render — `params` is null until the paywall is
  // triggered, so both arguments are guarded rather than the call site.
  //
  // Edge-triggered on `open`, not fired per render: this dialog re-renders
  // whenever an Autumn query settles, and an inflated impression count is the
  // denominator of every conversion rate on the monetization dashboard.
  usePaywallImpression(params?.open ?? false, params?.featureId ?? 'unknown');

  if (!params) {
    return <></>;
  }

  const { open, setOpen, featureId } = params;

  const featureI18nKey = isCreditBackedFeature(featureId)
    ? "credits"
    : getFeatureI18nKey(featureId);
  const featureName = tFeatures(`${featureI18nKey}.name`);

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
          <DialogTitle className="sr-only">{t("loading")}</DialogTitle>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const nextProduct = relevantProducts[0];
  const isOnHighestPlan = !nextProduct && !isLoading;
  const customPaywallKey = getFeaturePaywallKey(featureId);
  const previewWithProducts = preview
    ? { ...preview, products: relevantProducts }
    : undefined;

  const title = (() => {
    if (isOnHighestPlan) return t("featureUnavailable");
    if (previewWithProducts)
      return getPaywallTitle(previewWithProducts, t, trialState.trialEligible);
    if (nextProduct) return t("upgradeTo", { productName: nextProduct.name });
    return t("featureUnavailable");
  })();

  const message = (() => {
    if (isOnHighestPlan) return t("noUpgradeAvailable", { featureName });

    // Feature-specific custom template (e.g. courses with archive option)
    if (customPaywallKey && nextProduct) {
      const activeCourseCount = used > 0 ? used : Math.max(0, included - balance);
      return t(customPaywallKey, {
        activeCount: activeCourseCount,
        maxCourses: included,
        productName: nextProduct.name,
      });
    }

    // Autumn preview available
    if (previewWithProducts) {
      return getPaywallMessage(previewWithProducts, t, featureName, consumable);
    }

    // No preview, but have a product to recommend
    if (nextProduct) {
      const detail = t(
        consumable === false ? "upgradeDetailCap" : "upgradeDetailUsageLimit",
        { productName: nextProduct.name, featureName },
      );
      return consumable === false
        ? t("capReachedWithDetail", { featureName, detail })
        : t("usageLimitWithDetail", { featureName, detail });
    }

    return t(consumable === false ? "capReached" : "usageLimitReached", { featureName });
  })();

  const handleUpgrade = async () => {
    if (!nextProduct) return;
    setUpgrading(true);
    try {
      // First purchases must never reach checkout(): its preview would build
      // the session on the legacy path, which can't carry Managed Payments.
      // The v2 route always confirms on Stripe's hosted page instead.
      if (isFirstPurchase(trialState)) {
        await startNewPlanCheckout(nextProduct.id, trialState);
      } else {
        // autumn-js reports failures as an `{ error }` container, not a
        // throw — without the check this closed silently on failure.
        throwOnCheckoutError(
          await checkout({
            productId: nextProduct.id,
            dialog: CheckoutDialog,
            ...checkoutTrialParams(trialState),
          }),
        );
      }
      setOpen(false);
    } catch (e) {
      showCheckoutError(e, "paywall.upgrade");
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
        <DialogTitle className={cn("font-bold text-xl px-6")}>
          {title}
        </DialogTitle>
        <div className="px-6 my-2 text-muted-foreground">
          {message}
        </div>
        <DialogFooter className="dialog-footer-bar">
          <Button
            size="sm"
            variant="ghost"
            className="font-medium min-w-20"
            onClick={() => setOpen(false)}
          >
            {t("dismiss")}
          </Button>
          {isOnHighestPlan ? (
            <Button
              size="sm"
              className="font-medium shadow transition min-w-20 gap-1.5"
              asChild
            >
              <a href="mailto:support@flexling.com">
                <Mail className="h-3.5 w-3.5" />
                {t("contactUs")}
              </a>
            </Button>
          ) : nextProduct ? (
            <Button
              size="sm"
              className="font-medium shadow transition min-w-20 gap-1.5"
              onClick={handleUpgrade}
              disabled={upgrading}
            >
              {upgrading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  {t("upgradeTo", { productName: nextProduct.name })}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

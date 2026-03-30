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
import { findUpgradeProductFromPricingTable } from "@/lib/autumn/find-upgrade-product";
import { getPaywallTitle, getPaywallMessage, filterProductsByFeatureIncrease } from "@/lib/autumn/paywall-content";
import { getFeatureI18nKey, isFeatureConsumable, getFeaturePaywallKey } from "@/lib/features/feature-meta";
import { useFeatureQuota } from "@/components/feature_tracking/useFeatureQuota";
import { cn } from "@/lib/utils";
import CheckoutDialog from "@/components/autumn/checkout-dialog";

export interface PaywallDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  featureId: string;
  entityId?: string;
}

export default function PaywallDialog(params?: PaywallDialogProps) {
  const t = useTranslations("Paywall");
  const tFeatures = useTranslations("Features");
  const { data: preview, isLoading } = usePaywall({
    featureId: params?.featureId,
    entityId: params?.entityId,
  });
  const { products: pricingTableProducts } = usePricingTable();
  const { checkout } = useCustomer();
  const [upgrading, setUpgrading] = useState(false);
  const filterFeatureId = params?.featureId ?? "";
  const consumable = isFeatureConsumable(filterFeatureId);
  const { balance, included, used } = useFeatureQuota(filterFeatureId);

  const relevantProducts = useMemo(() => {
    const filtered = filterProductsByFeatureIncrease(
      preview?.products ?? [],
      filterFeatureId,
      included,
      consumable,
    );
    if (filtered.length > 0) return filtered;
    const fallback = findUpgradeProductFromPricingTable(
      pricingTableProducts ?? undefined,
      filterFeatureId,
      included,
      consumable,
    );
    return fallback ? [fallback] : [];
  }, [
    preview?.products,
    pricingTableProducts,
    filterFeatureId,
    included,
    consumable,
  ]);

  if (!params) {
    return <></>;
  }

  const { open, setOpen, featureId } = params;

  const featureI18nKey = getFeatureI18nKey(featureId);
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
    if (previewWithProducts) return getPaywallTitle(previewWithProducts, t);
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
      await checkout({
        productId: nextProduct.id,
        dialog: CheckoutDialog,
      });
      setOpen(false);
    } catch (e) {
      console.error("Checkout failed:", e);
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
        <DialogFooter className="flex flex-col-reverse sm:flex-row justify-between gap-2 py-3 px-6 bg-secondary border-t">
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

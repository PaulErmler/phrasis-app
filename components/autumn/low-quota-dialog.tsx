"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCustomer, usePricingTable } from "autumn-js/react";
import {
  findCurrentIntervalGroup,
  findUpgradeProductFromPricingTable,
} from "@/lib/autumn/find-upgrade-product";
import { getTrialState } from "@/lib/autumn/trial-eligibility";
import { getFeatureI18nKey, isFeatureConsumable } from "@/lib/features/feature-meta";
import { isCreditBackedFeature } from "@/convex/features/featureIds";
import { useFeatureQuota } from "@/components/feature_tracking/useFeatureQuota";
import CheckoutDialog from "@/components/autumn/checkout-dialog";
import { useIsNativeApp } from "@/hooks/use-native-app";
import { useNewPlanCheckout } from "@/hooks/use-new-plan-checkout";
import { useCheckoutErrorToast } from "@/hooks/use-checkout-error";

export interface LowQuotaDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  balance: number;
  featureId: string;
}

export default function LowQuotaDialog({
  open,
  setOpen,
  balance,
  featureId,
}: LowQuotaDialogProps) {
  const t = useTranslations("LowQuota");
  const tFeatures = useTranslations("Features");
  const { checkout, customer } = useCustomer({ expand: ["trials_used"] });
  const trialState = getTrialState(customer);
  const { products } = usePricingTable();
  const { purchasePlan } = useNewPlanCheckout();
  const showCheckoutError = useCheckoutErrorToast();
  const [upgrading, setUpgrading] = useState(false);

  const { included } = useFeatureQuota(featureId);

  const featureI18nKey = getFeatureI18nKey(featureId);
  const featureName = tFeatures(`${featureI18nKey}.name`);
  const consumable = isFeatureConsumable(featureId);
  const creditBacked = isCreditBackedFeature(featureId);

  // Store builds must not offer upgrades. Forcing "no upgrade available"
  // routes every branch below to the neutral contact-support copy.
  const isNative = useIsNativeApp();
  const upgradeProduct = isNative
    ? undefined
    : findUpgradeProductFromPricingTable(
      products ?? undefined,
      featureId,
      included,
      consumable,
      findCurrentIntervalGroup(customer, products ?? undefined),
    );

  const handleUpgrade = async () => {
    if (!upgradeProduct) return;
    setUpgrading(true);
    try {
      await purchasePlan({
        productId: upgradeProduct.id,
        trialState,
        checkout,
        dialog: CheckoutDialog,
      });
      setOpen(false);
    } catch (e) {
      showCheckoutError(e, "lowQuota.upgrade");
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
        <DialogTitle className="font-bold text-xl px-6">
          {creditBacked ? t("titleCredits") : t("title", { featureName })}
        </DialogTitle>
        <p className="px-6 mt-1 mb-2 text-muted-foreground">
          {creditBacked
            ? upgradeProduct
              ? t("descriptionCredits", { balance })
              : t("noUpgradeAvailableCredits")
            : upgradeProduct
              ? t(consumable === false ? "descriptionCap" : "description", { balance, featureName })
              : t(consumable === false ? "noUpgradeAvailableCap" : "noUpgradeAvailable", { featureName })}
        </p>

        <DialogFooter className="dialog-footer-bar">
          <Button
            size="sm"
            variant="ghost"
            className="font-medium min-w-20"
            onClick={() => setOpen(false)}
          >
            {t("dismiss")}
          </Button>
          {upgradeProduct ? (
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
                  {t("upgrade", { productName: upgradeProduct.name })}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          ) : (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

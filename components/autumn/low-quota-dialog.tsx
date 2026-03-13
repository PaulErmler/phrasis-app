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
import { getFeatureI18nKey, isFeatureConsumable } from "@/lib/features/feature-meta";
import CheckoutDialog from "@/components/autumn/checkout-dialog";

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
  const { checkout } = useCustomer();
  const { products } = usePricingTable();
  const [upgrading, setUpgrading] = useState(false);

  const featureI18nKey = getFeatureI18nKey(featureId);
  const featureName = tFeatures(`${featureI18nKey}.name`);
  const consumable = isFeatureConsumable(featureId);

  const upgradeProduct = products?.find(
    (p) => p.scenario === "upgrade" || (p.scenario === "new" && !p.properties?.is_free),
  );

  const handleUpgrade = async () => {
    if (!upgradeProduct) return;
    setUpgrading(true);
    try {
      await checkout({
        productId: upgradeProduct.id,
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
        <DialogTitle className="font-bold text-xl px-6">
          {t("title", { featureName })}
        </DialogTitle>
        <p className="px-6 mt-1 mb-2 text-muted-foreground">
          {upgradeProduct
            ? t(consumable === false ? "descriptionCap" : "description", { balance, featureName })
            : t(consumable === false ? "noUpgradeAvailableCap" : "noUpgradeAvailable", { featureName })}
        </p>

        <DialogFooter className="flex flex-col-reverse sm:flex-row justify-between gap-2 py-3 px-6 bg-secondary border-t">
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
              <a href="mailto:support@cacatua.app">
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

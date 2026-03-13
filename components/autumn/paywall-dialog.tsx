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
import { usePaywall, useCustomer } from "autumn-js/react";
import { getPaywallContent } from "@/lib/autumn/paywall-content";
import { getFeatureI18nKey, isFeatureConsumable } from "@/lib/features/feature-meta";
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
  const { checkout } = useCustomer();
  const [upgrading, setUpgrading] = useState(false);

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

  const consumable = isFeatureConsumable(featureId);
  const { title, message } = getPaywallContent(preview, t, featureName, consumable);
  const nextProduct = preview?.products?.[0];

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

  const isOnHighestPlan = !nextProduct && !isLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
        <DialogTitle className={cn("font-bold text-xl px-6")}>
          {isOnHighestPlan
            ? t("featureUnavailable")
            : title}
        </DialogTitle>
        <div className="px-6 my-2 text-muted-foreground">
          {isOnHighestPlan
            ? t("noUpgradeAvailable", { featureName })
            : message}
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
              <a href="mailto:support@cacatua.app">
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

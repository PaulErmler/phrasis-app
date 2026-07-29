"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { CLIENT_EVENTS } from "@/lib/posthog/events";
import { useImpression } from "@/lib/posthog/use-impression";
import { getFeatureI18nKey } from "@/lib/features/feature-meta";
import { isCreditBackedFeature } from "@/convex/features/featureIds";

export interface UsageLimitDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  featureId: string;
}

/**
 * Lightweight "limit reached" dialog for hidden / internal-only features.
 * Unlike PaywallDialog this makes no Autumn API calls and has no upgrade flow —
 * it simply tells the user to contact support.
 */
export default function UsageLimitDialog({
  open,
  setOpen,
  featureId,
}: UsageLimitDialogProps) {
  const t = useTranslations("Paywall");
  const tFeatures = useTranslations("Features");

  // Distinct from the paywall: this is the dead-end variant with no upgrade
  // path, so its volume is a signal that a feature needs a plan to sell into.
  useImpression(CLIENT_EVENTS.PAYWALL_SHOWN, open, {
    feature_id: featureId,
    variant: 'no_upgrade_path',
  });

  const featureName = tFeatures(
    `${isCreditBackedFeature(featureId) ? "credits" : getFeatureI18nKey(featureId)}.name`,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
        <DialogTitle className="font-bold text-xl px-6">
          {t("featureUnavailable")}
        </DialogTitle>
        <div className="px-6 my-2 text-muted-foreground">
          {t("usageLimitNoProducts", { featureName })}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

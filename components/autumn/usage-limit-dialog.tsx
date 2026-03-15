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
import { getFeatureI18nKey } from "@/lib/features/feature-meta";

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

  const featureName = tFeatures(`${getFeatureI18nKey(featureId)}.name`);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
        <DialogTitle className="font-bold text-xl px-6">
          {t("featureUnavailable")}
        </DialogTitle>
        <div className="px-6 my-2 text-muted-foreground">
          {t("usageLimitNoProducts", { featureName })}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

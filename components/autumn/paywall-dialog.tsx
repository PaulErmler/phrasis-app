"use client";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePaywall } from "autumn-js/react";
import { getPaywallContent } from "@/lib/autumn/paywall-content";
import { cn } from "@/lib/utils";

export interface PaywallDialogProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  featureId: string;
  entityId?: string;
}

export default function PaywallDialog(params?: PaywallDialogProps) {
  const t = useTranslations("Paywall");
  const { data: preview } = usePaywall({
    featureId: params?.featureId,
    entityId: params?.entityId,
  });

  if (!params) {
    return <></>;
  }

  const { open, setOpen } = params;

  if (!preview) {
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

  const { title, message } = getPaywallContent(preview, t);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
        <DialogTitle className={cn("font-bold text-xl px-6")}>
          {title}
        </DialogTitle>
        <div className="px-6 my-2">{message}</div>
        <DialogFooter className="flex flex-col sm:flex-row justify-between gap-x-4 py-2 mt-4 pl-6 pr-3 bg-secondary border-t">
          <Button
            size="sm"
            className="font-medium shadow transition min-w-20"
            onClick={async () => {
              setOpen(false);
            }}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

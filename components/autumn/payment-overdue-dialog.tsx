"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CLIENT_EVENTS, capture } from "@/lib/posthog/events";
import { useImpression } from "@/lib/posthog/use-impression";
import { usePathname } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { useCustomer } from "autumn-js/react";
import { toast } from "sonner";
import { useIsNativeApp } from "@/hooks/use-native-app";

/**
 * App-wide dunning popup. Mounted once in BillingGate (from the /app layout)
 * so it covers every route including the standalone /app/learn page; opens
 * whenever the synced billing state is past due. Full policy (no grace
 * window, the two exits, admin-route exclusion, `assertBillingCurrent`
 * backstop): documentation/autumn-usage-tracking.md, "Past-due (dunning)
 * flow".
 *
 * Split into this thin gate and the dialog proper: the inner component only
 * mounts while the block is active, so (a) its state (`confirmingCancel`,
 * `busy`) starts fresh for every dunning episode instead of a later episode
 * reopening on the destructive confirm step, and (b) `useCustomer()` — a
 * real Autumn customer fetch — never runs for healthy users just because
 * the gate is mounted app-wide.
 */
export default function PaymentOverdueDialog() {
  const pathname = usePathname();
  const quotas = useQuery(api.usage.queries.getMyQuotas);

  // `pastDue` is exactly `pastDueSince !== undefined` server-side, so reading
  // the timestamp is the same gate — and it narrows the type for the
  // "overdue since {date}" copy instead of leaving it to a dead fallback.
  const pastDueSince =
    quotas?.pastDue === true ? quotas.pastDueSince : undefined;
  if (!quotas || pastDueSince === undefined) return null;
  if (pathname.startsWith("/app/admin")) return null;

  return (
    <PaymentOverdueDialogContent quotas={quotas} pastDueSince={pastDueSince} />
  );
}

type Quotas = NonNullable<
  FunctionReturnType<typeof api.usage.queries.getMyQuotas>
>;

/**
 * Secondary (opt-out) action in the footer.
 *
 * `mr-auto` rather than relying on the bar's `justify-between`: DialogFooter's
 * own `sm:justify-end` is a utility and wins over the `@apply` inside
 * `.dialog-footer-bar`, which would otherwise park this next to the primary
 * button. The transparent border reserves the space an outline needs, so
 * revealing it on hover gives feedback without shifting the layout.
 */
const SECONDARY_ACTION =
  'font-medium min-w-20 mr-auto border border-transparent hover:border-border';

function PaymentOverdueDialogContent({
  quotas,
  pastDueSince,
}: {
  quotas: Quotas;
  pastDueSince: number;
}) {
  const t = useTranslations("PaymentOverdue");
  const locale = useLocale();
  // Store builds must not link out to Stripe (invoice or billing portal) —
  // they get contact-support instead; the cancel path stays available.
  const isNative = useIsNativeApp();
  // Same expand (and therefore the same SWR cache key) as the pricing
  // table / paywall / checkout surfaces, so the refetch after a cancel
  // updates what /app/settings displays — without it the settings page
  // keeps showing the cancelled plan as subscribed until a full reload.
  const { openBillingPortal, refetch } = useCustomer({
    expand: ["trials_used"],
  });
  const cancelOverdue = useAction(api.billing.cancelOverdueSubscription);

  const [busy, setBusy] = useState<"pay" | "portal" | "cancel" | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // handlePay leaves `busy` set on purpose while the tab navigates away —
  // but coming BACK from the Stripe invoice page via the browser's Back
  // button restores this page from bfcache with React state intact, which
  // would leave every button in this hard block disabled forever.
  // `pageshow.persisted` marks exactly that restore. BillingGate listens for
  // the same event to re-sync the mirror (which is what actually lifts the
  // block once the payment lands); this handler only unfreezes the UI.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const invoiceUrl = quotas.pastDueInvoiceUrl;

  // This dialog is a hard block on the whole app, so its volume is a direct
  // measure of involuntary churn. `open` is unconditional here (the component
  // only mounts while past due), so the impression is edge-triggered on mount.
  useImpression(CLIENT_EVENTS.PAYMENT_PAST_DUE_SHOWN, true, {
    has_invoice_url: quotas.pastDueInvoiceUrl !== undefined,
    active_course_count: quotas.activeCourseCount,
  });
  // Free keeps exactly one active course, so everything above that goes.
  const coursesArchived = Math.max(quotas.activeCourseCount - 1, 0);

  const handlePay = () => {
    if (!invoiceUrl) return;
    capture(CLIENT_EVENTS.CHECKOUT_REDIRECTED, { flow: 'past_due_invoice' });
    setBusy("pay");
    window.location.href = invoiceUrl;
  };

  /** Fallback when Autumn never surfaced a payable invoice URL. */
  const handlePortal = async () => {
    setBusy("portal");
    try {
      const res = await openBillingPortal({ returnUrl: window.location.href });
      if (res.error) {
        console.error("Billing portal failed:", res.error);
        toast.error(t("portalError"));
      }
    } catch (e) {
      console.error("Billing portal failed:", e);
      toast.error(t("portalError"));
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    setBusy("cancel");
    try {
      const res = await cancelOverdue({});
      // The server already re-synced the Convex quota mirror (which is what
      // unmounts this dialog); refresh the client-side Autumn customer cache
      // too so settings/pricing reflect the change without a reload. The
      // cancel itself succeeded either way, so a refetch failure is not an
      // error the user needs to see.
      await refetch().catch(() => undefined);
      toast.success(
        res.outcome === "recovered" ? t("paymentReceived") : t("cancelSuccess"),
      );
    } catch (e) {
      console.error("Cancel failed:", e);
      toast.error(t("cancelError"));
    } finally {
      setBusy(null);
      setConfirmingCancel(false);
    }
  };

  return (
    <Dialog open>
      <DialogContent
        data-testid="payment-overdue-dialog"
        className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm"
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="font-bold text-xl px-6">
          {confirmingCancel ? t("cancelTitle") : t("title")}
        </DialogTitle>

        {confirmingCancel ? (
          <p
            data-testid="payment-overdue-cancel-warning"
            className="px-6 mt-1 mb-2 text-muted-foreground"
          >
            {coursesArchived > 0
              ? t("cancelWarning", { count: coursesArchived })
              : t("cancelWarningNoCourses")}
          </p>
        ) : (
          <>
            <p className="px-6 mt-1 text-muted-foreground">
              {isNative ? t("nativeDescription") : t("description")}
            </p>
            {!isNative && (
              <p
                data-testid="payment-overdue-notice"
                className="px-6 mt-2 mb-2 text-muted-foreground"
              >
                {t("blockedDescription", {
                  date: new Date(pastDueSince).toLocaleDateString(locale),
                })}
              </p>
            )}
          </>
        )}

        <DialogFooter className="dialog-footer-bar">
          {confirmingCancel ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className={SECONDARY_ACTION}
                data-testid="payment-overdue-cancel-back"
                onClick={() => setConfirmingCancel(false)}
                disabled={busy !== null}
              >
                {t("back")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="font-medium shadow transition min-w-20"
                data-testid="payment-overdue-cancel-confirm"
                onClick={handleCancel}
                disabled={busy !== null}
              >
                {busy === "cancel" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  t("cancelConfirm")
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className={SECONDARY_ACTION}
                data-testid="payment-overdue-cancel"
                onClick={() => setConfirmingCancel(true)}
                disabled={busy !== null}
              >
                {t("cancelButton")}
              </Button>
              {isNative ? (
                <Button
                  size="sm"
                  className="font-medium shadow transition min-w-20 gap-1.5"
                  data-testid="payment-overdue-contact"
                  asChild
                >
                  <a href="mailto:support@flexling.com">
                    <Mail className="h-3.5 w-3.5" />
                    {t("contactUs")}
                  </a>
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="font-medium shadow transition min-w-20 gap-1.5"
                  data-testid="payment-overdue-pay"
                  onClick={invoiceUrl ? handlePay : handlePortal}
                  disabled={busy !== null}
                >
                  {busy === "pay" || busy === "portal" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <CreditCard className="h-3.5 w-3.5" />
                      {invoiceUrl ? t("payInvoiceButton") : t("payButton")}
                    </>
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

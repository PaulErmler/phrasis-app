"use client";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import type { CheckoutParams, CheckoutResult, ProductItem } from "autumn-js";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCustomer, usePricingTable } from "autumn-js/react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getCheckoutContent } from "@/lib/autumn/checkout-content";
import {
  checkoutTrialParams,
  findCurrentPaidProduct,
  getTrialState,
} from "@/lib/autumn/trial-eligibility";

export interface CheckoutDialogProps {
	open: boolean;
	setOpen: (open: boolean) => void;
	checkoutResult: CheckoutResult;
	checkoutParams?: CheckoutParams;
}

const formatCurrency = ({
  amount,
  currency,
  locale,
}: {
	amount: number;
	currency: string;
	locale?: string;
}) => {
  return new Intl.NumberFormat(locale ?? "en-US", {
    style: "currency",
    currency: currency,
  }).format(amount);
};

export default function CheckoutDialog(params: CheckoutDialogProps) {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const { attach, customer, refetch } = useCustomer({
    expand: ["trials_used"],
  });
  // The pricing table's CTA labels come from usePricingTable's per-customer
  // scenarios, cached in SWR. autumn-js's attach() refetches that cache
  // internally, but the switchPlanDuringTrial path bypasses attach() — so
  // it must refetch the shared cache itself or the table shows the old
  // scenario (e.g. "Cancel" instead of "Plan Scheduled") until a reload.
  const { refetch: refetchPricingTable } = usePricingTable();
  const switchPlanDuringTrial = useAction(api.billing.switchPlanDuringTrial);
  const trialState = getTrialState(customer);
  const [checkoutResult, setCheckoutResult] = useState<
		CheckoutResult | undefined
	>(params?.checkoutResult);

  useEffect(() => {
    if (params.checkoutResult) {
      setCheckoutResult(params.checkoutResult);
    }
  }, [params.checkoutResult]);

  const [loading, setLoading] = useState(false);
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  // Close dialog when route changes (e.g. user navigates back)
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      if (params.open) {
        params.setOpen(false);
      }
    }
  }, [pathname, params]);

  if (!checkoutResult) {
    return <></>;
  }

  const { open, setOpen } = params;
  // Autumn's checkout preview reports next_cycle one year early for annual
  // plans; the customer's own current_period_end is the reliable source
  // for period-end-anchored dates (see getCheckoutContent opts doc).
  const currentPeriodEndsAt =
    findCurrentPaidProduct(customer?.products)?.currentPeriodEnd;
  const { title, message } = getCheckoutContent(checkoutResult, t, trialState, {
    currentPeriodEndsAt,
    locale,
  });

  const isFree = checkoutResult?.product.properties?.is_free;
  const isPaid = isFree === false;

  // A currently-trialing user switching plans keeps their running trial —
  // confirm routes through the Convex action (which schedules downgrades
  // at trial end and carries the trial over on immediate switches) instead
  // of a plain attach, which the server-side trial gate rejects. This
  // includes the Free plan — scheduled at trial end like any downgrade
  // (Autumn classifies a free/default target as "downgrade" or "cancel")
  // — and "renew", i.e. re-attaching the trialing plan to un-schedule a
  // pending switch. Must mirror the scenarios accepted by
  // convex/billing.ts switchPlanDuringTrial.
  const scenario = checkoutResult.product.scenario;
  const isTrialSwitch =
    trialState.onTrial &&
    !checkoutResult.product.properties?.is_one_off &&
    (isPaid
      ? scenario === "upgrade" ||
        scenario === "downgrade" ||
        scenario === "new" ||
        scenario === "renew"
      : isFree === true &&
        (scenario === "downgrade" || scenario === "cancel"));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 pt-4 gap-0 text-foreground text-sm">
        <DialogTitle data-testid="checkout-dialog-title" className="px-6 mb-1">
          {title}
        </DialogTitle>
        <div
          data-testid="checkout-dialog-message"
          className="px-6 mt-1 mb-4 text-muted-foreground"
        >
          {message}
        </div>

        {isPaid && checkoutResult && (
          <PriceInformation
            checkoutResult={checkoutResult}
            setCheckoutResult={setCheckoutResult}
            trialSwitchEndsAt={
              isTrialSwitch ? trialState.trialEndsAt : undefined
            }
            currentPeriodEndsAt={currentPeriodEndsAt}
          />
        )}

        {isPaid && !checkoutResult.product.properties?.is_one_off && (
          <p
            data-testid="checkout-no-commitment"
            className="px-6 mb-4 text-xs text-muted-foreground"
          >
            {t("noCommitment")}
          </p>
        )}

        <DialogFooter className="flex flex-col sm:flex-row justify-between gap-x-4 py-2 pl-6 pr-3 bg-secondary border-t shadow-inner">
          <Button
            size="sm"
            onClick={async () => {
              setLoading(true);
              try {
                if (isTrialSwitch) {
                  const result = await switchPlanDuringTrial({
                    productId: checkoutResult.product.id,
                  });
                  // Card is normally on file during a trial; if Autumn
                  // still needs payment action, send the user there.
                  if (result.paymentUrl) {
                    window.location.href = result.paymentUrl;
                    return;
                  }
                  await Promise.all([refetch(), refetchPricingTable()]);
                } else {
                  const options = checkoutResult.options.map((option) => ({
                    featureId: option.feature_id,
                    quantity: option.quantity,
                  }));

                  await attach({
                    productId: checkoutResult.product.id,
                    ...(params.checkoutParams || {}),
                    ...checkoutTrialParams(trialState),
                    options,
                  });
                }
                setOpen(false);
              } catch (e) {
                // Surface the failure — a silently-reset dialog looks like
                // nothing happened (this hid the trial-gate rejection).
                console.error("Checkout failed:", e);
                toast.error(t("confirmError"));
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            data-testid="checkout-dialog-confirm"
            className="min-w-16 flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span className="whitespace-nowrap">
                {t("confirm")}
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceInformation({
  checkoutResult,
  setCheckoutResult,
  trialSwitchEndsAt,
  currentPeriodEndsAt,
}: {
	checkoutResult: CheckoutResult;
	setCheckoutResult: (checkoutResult: CheckoutResult) => void;
	trialSwitchEndsAt?: number;
	currentPeriodEndsAt?: number;
}) {
  return (
    <div className="px-6 mb-4 flex flex-col gap-4">
      <ProductItems
        checkoutResult={checkoutResult}
        setCheckoutResult={setCheckoutResult}
      />

      <div className="flex flex-col gap-2">
        {!trialSwitchEndsAt &&
          checkoutResult?.has_prorations &&
          checkoutResult.lines.length > 0 && (
          <CheckoutLines checkoutResult={checkoutResult} />
        )}
        <DueAmounts
          checkoutResult={checkoutResult}
          trialSwitchEndsAt={trialSwitchEndsAt}
          currentPeriodEndsAt={currentPeriodEndsAt}
        />
      </div>
    </div>
  );
}

function DueAmounts({
  checkoutResult,
  trialSwitchEndsAt,
  currentPeriodEndsAt,
}: {
	checkoutResult: CheckoutResult;
	trialSwitchEndsAt?: number;
	currentPeriodEndsAt?: number;
}) {
  const t = useTranslations("Checkout");
  const locale = useLocale();
  const { next_cycle, product } = checkoutResult;

  const hasUsagePrice = product.items.some(
    (item) => item.usage_model === "pay_per_use",
  );

  // Plan switch during a running trial: nothing is charged now — the
  // preview's totals/next_cycle can reflect a phantom fresh trial or an
  // immediate charge that won't happen. Billing starts at the (kept)
  // trial end, at the target plan's own price.
  if (trialSwitchEndsAt) {
    const planPrice =
      product.items.find((item) => item.type === "price")?.price ??
      next_cycle?.total ??
      checkoutResult.total;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex justify-between">
          <p className="font-medium text-md">{t("totalDueToday")}</p>
          <p data-testid="checkout-due-today" className="font-medium text-md">
            {formatCurrency({
              amount: 0,
              currency: checkoutResult?.currency,
            })}
          </p>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <p className="text-md">
            {t("dueNextCycle", {
              date: new Date(trialSwitchEndsAt).toLocaleDateString(locale),
            })}
          </p>
          <p className="text-md">
            {formatCurrency({
              amount: planPrice,
              currency: checkoutResult?.currency,
            })}
            {hasUsagePrice && <span> {t("plusUsagePrices")}</span>}
          </p>
        </div>
      </div>
    );
  }

  // For period-end-anchored scenarios the customer's own period end is
  // the reliable date — Autumn's preview reports next_cycle one year
  // early for annual plans (see getCheckoutContent).
  const periodEndAnchored =
    product.scenario === "downgrade" ||
    product.scenario === "cancel" ||
    product.scenario === "scheduled";
  const nextCycleAt =
    periodEndAnchored && currentPeriodEndsAt !== undefined
      ? currentPeriodEndsAt
      : next_cycle?.starts_at;
  const nextCycleAtStr =
    nextCycleAt !== undefined
      ? new Date(nextCycleAt).toLocaleDateString(locale)
      : undefined;

  const showNextCycle = next_cycle && next_cycle.total !== checkoutResult.total;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between">
        <div>
          <p className="font-medium text-md">{t("totalDueToday")}</p>
        </div>

        <p data-testid="checkout-due-today" className="font-medium text-md">
          {formatCurrency({
            amount: checkoutResult?.total,
            currency: checkoutResult?.currency,
          })}
        </p>
      </div>
      {showNextCycle && (
        <div className="flex justify-between text-muted-foreground">
          <div>
            <p className="text-md">
              {t("dueNextCycle", { date: nextCycleAtStr ?? "" })}
            </p>
          </div>
          <p className="text-md">
            {formatCurrency({
              amount: next_cycle.total,
              currency: checkoutResult?.currency,
            })}
            {hasUsagePrice && <span> {t("plusUsagePrices")}</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function formatPeriodLabel(
  secondaryText: string | undefined,
  tPricing: (key: "perMonth" | "perYear") => string
): string {
  if (!secondaryText) return "";
  if (secondaryText === "per month") return tPricing("perMonth");
  if (secondaryText === "per year") return tPricing("perYear");
  return secondaryText;
}

function ProductItems({
  checkoutResult,
  setCheckoutResult,
}: {
	checkoutResult: CheckoutResult;
	setCheckoutResult: (checkoutResult: CheckoutResult) => void;
}) {
  const t = useTranslations("Checkout");
  const tPricing = useTranslations("Pricing");

  const isUpdateQuantity =
		checkoutResult?.product.scenario === "active" &&
		checkoutResult.product.properties.updateable;

  const isOneOff = checkoutResult?.product.properties.is_one_off;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{t("price")}</p>
      {checkoutResult?.product.items
        .filter((item) => item.type !== "feature")
        .map((item, index) => {
          if (item.usage_model === "prepaid") {
            return (
              <PrepaidItem
                key={index}
                item={item}
                checkoutResult={checkoutResult!}
                setCheckoutResult={setCheckoutResult}
              />
            );
          }

          if (isUpdateQuantity) {
            return null;
          }

          return (
            <div key={index} className="flex justify-between">
              <p className="text-muted-foreground">
                {item.feature
                  ? item.feature.name
                  : isOneOff
                    ? t("price")
                    : t("subscription")}
              </p>
              <p>
                {item.display?.primary_text}{" "}
                {formatPeriodLabel(item.display?.secondary_text, tPricing)}
              </p>
            </div>
          );
        })}
    </div>
  );
}

function CheckoutLines({ checkoutResult }: { checkoutResult: CheckoutResult }) {
  const t = useTranslations("Checkout");
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="total" className="border-b-0">
        <CustomAccordionTrigger className="justify-between w-full my-0 py-0 border-none">
          <div className="cursor-pointer flex items-center gap-1 w-full justify-end">
            <p className="font-light text-muted-foreground">
              {t("viewDetails")}
            </p>
            <ChevronDown
              className="text-muted-foreground mt-0.5 rotate-90 transition-transform duration-200 ease-in-out"
              size={14}
            />
          </div>
        </CustomAccordionTrigger>
        <AccordionContent className="mt-2 mb-0 pb-2 flex flex-col gap-2">
          {checkoutResult?.lines
            .filter((line) => line.amount !== 0)
            .map((line, index) => {
              return (
                <div key={index} className="flex justify-between">
                  <p className="text-muted-foreground">{line.description}</p>
                  <p className="text-muted-foreground">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: checkoutResult?.currency,
                    }).format(line.amount)}
                  </p>
                </div>
              );
            })}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function CustomAccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]_svg]:rotate-0",
          className,
        )}
        {...props}
      >
        {children}
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

const PrepaidItem = ({
  item,
  checkoutResult,
  setCheckoutResult,
}: {
	item: ProductItem;
	checkoutResult: CheckoutResult;
	setCheckoutResult: (checkoutResult: CheckoutResult) => void;
}) => {
  const t = useTranslations("Checkout");
  const tPricing = useTranslations("Pricing");
  const { quantity = 0, billing_units: billingUnits = 1 } = item;
  const [quantityInput, setQuantityInput] = useState<string>(
    (quantity / billingUnits).toString(),
  );
  const { checkout, customer } = useCustomer({ expand: ["trials_used"] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const scenario = checkoutResult.product.scenario;
  const trialState = getTrialState(customer);

  const handleSave = async () => {
    setLoading(true);
    try {
      const newOptions = checkoutResult.options
        .filter((option) => option.feature_id !== item.feature_id)
        .map((option) => {
          return {
            featureId: option.feature_id,
            quantity: option.quantity,
          };
        });

      newOptions.push({
        featureId: item.feature_id!,
        quantity: Number(quantityInput) * billingUnits,
      });

      const { data, error } = await checkout({
        productId: checkoutResult.product.id,
        options: newOptions,
        dialog: CheckoutDialog,
        ...checkoutTrialParams(trialState),
      });

      if (error) {
        console.error(error);
        return;
      }
      setCheckoutResult(data!);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const disableSelection = scenario === "renew";

  return (
    <div className="flex justify-between gap-2">
      <div className="flex gap-2 items-start">
        <p className="text-muted-foreground whitespace-nowrap">
          {item.feature?.name}
        </p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            className={cn(
              "text-muted-foreground text-xs px-1 py-0.5 rounded-md flex items-center gap-1 bg-accent/80 shrink-0",
              disableSelection !== true &&
								"hover:bg-accent hover:text-foreground",
              disableSelection &&
								"pointer-events-none opacity-80 cursor-not-allowed",
            )}
            disabled={disableSelection}
          >
            {t("qty", { quantity })}
            {!disableSelection && <ChevronDown size={12} />}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-80 text-sm p-4 pt-3 flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{item.feature?.name}</p>
              <p className="text-muted-foreground">
                {item.display?.primary_text}{" "}
                {formatPeriodLabel(item.display?.secondary_text, tPricing)}
              </p>
            </div>

            <div className="flex justify-between items-end">
              <div className="flex gap-2 items-center">
                <Input
                  className="h-7 w-16 focus:!ring-2"
                  value={quantityInput}
                  onChange={(e) => setQuantityInput(e.target.value)}
                />
                <p className="text-muted-foreground">
                  {billingUnits > 1 && `x ${billingUnits} `}
                  {item.feature?.name}
                </p>
              </div>

              <Button
                onClick={handleSave}
                className="w-14 !h-7 text-sm items-center bg-white text-foreground shadow-sm border border-zinc-200 hover:bg-zinc-100"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="text-muted-foreground animate-spin !w-4 !h-4" />
                ) : (
                  t("save")
                )}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-end">
        {item.display?.primary_text}{" "}
        {formatPeriodLabel(item.display?.secondary_text, tPricing)}
      </p>
    </div>
  );
};

export const PriceItem = ({
  children,
  className,
  ...props
}: {
	children: React.ReactNode;
	className?: string;
} & React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        "flex flex-col pb-4 sm:pb-0 gap-1 sm:flex-row justify-between sm:h-7 sm:gap-2 sm:items-center",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const PricingDialogButton = ({
  children,
  size,
  onClick,
  disabled,
  className,
}: {
	children: React.ReactNode;
	size?: "sm" | "lg" | "default" | "icon";
	onClick: () => void;
	disabled?: boolean;
	className?: string;
}) => {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      size={size}
      className={cn(className, "shadow-sm shadow-stone-400")}
    >
      {children}
      <ArrowRight className="!h-3" />
    </Button>
  );
};

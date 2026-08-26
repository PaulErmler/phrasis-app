import React from "react";

import { useCustomer, usePricingTable, ProductDetails } from "autumn-js/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CLIENT_EVENTS, capture } from "@/lib/posthog/events";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import CheckoutDialog from "@/components/autumn/checkout-dialog";
import { getPricingTableContent } from "@/lib/autumn/pricing-table-content";
import { getTrialState } from "@/lib/autumn/trial-eligibility";
import {
  findCurrentPaidPlan,
  normalizePlans,
  type AutumnPlan,
} from "@/lib/autumn/customer-shape";
import { FEATURE_META, getFeatureI18nKey, getFeatureDisplayCount, isFeatureHidden, isFeatureDisplayedAsUnlimited, isFeatureConsumable } from "@/lib/features/feature-meta";
import type { Product, ProductItem } from "autumn-js";
import { Loader2 } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { CarouselDots } from "@/components/ui/carousel-dots";
import { useIsNativeApp } from "@/hooks/use-native-app";
import { useNewPlanCheckout } from "@/hooks/use-new-plan-checkout";
import { useCheckoutErrorToast } from "@/hooks/use-checkout-error";

import { reportError } from '@/lib/report-error';

/** Sort key for plan cards: Free first, then paid plans by ascending price. */
function productSortPrice(product: Product): number {
  if (product.properties?.is_free) return -1;
  const price = product.items[0]?.price;
  return typeof price === "number" ? price : 0;
}

/**
 * Extra bullets that are pure marketing copy with no Autumn feature behind
 * them, so they cannot come from `product.items` and are never metered or
 * enforced. Keyed by base plan id. The `_annual` variants share their base
 * plan's copy. Values are keys in the `Pricing` i18n namespace.
 */
const EXTRA_PLAN_FEATURES: Record<string, string[]> = {
  ultra: ["priorityFeatureAccess", "prioritySupport"],
};

/** Paid plans billed on the same interval as `product`, cheapest first. */
function paidTiersInSameInterval(
  product: Product,
  products: Product[],
): Product[] {
  return products
    .filter(
      (p) =>
        !p.properties?.is_free &&
        p.properties?.interval_group === product.properties?.interval_group,
    )
    .sort((a, b) => productSortPrice(a) - productSortPrice(b));
}

/**
 * Rank of a paid plan within its own interval group (0 = cheapest tier).
 * Used to compare tiers ACROSS billing intervals, where raw prices mislead:
 * Basic Annual (€72) costs more than a month of Pro (€16), so Autumn labels
 * it an "upgrade", but tier-wise it is a downgrade.
 */
function paidTierRank(product: Product, products: Product[]): number {
  return paidTiersInSameInterval(product, products).findIndex(
    (p) => p.id === product.id,
  );
}

/**
 * The tier this card builds on: the next cheaper paid plan in the same
 * billing interval, or Free for the entry tier. Undefined when there is
 * nothing below it on the table (the free card itself).
 */
export function previousTier(
  product: Product,
  products: Product[],
): Product | undefined {
  if (product.properties?.is_free) return undefined;
  const rank = paidTierRank(product, products);
  if (rank > 0) return paidTiersInSameInterval(product, products)[rank - 1];
  return products.find((p) => p.properties?.is_free);
}

/**
 * The items this plan adds on top of `previous`. A bigger allowance, or a
 * feature the tier below does not grant at all. Everything else is already
 * covered by the "Everything from X, plus:" line, so repeating it is noise:
 * Ultra and Pro differ only in credits, and listing seven identical bullets
 * hides that.
 *
 * Consumable pools are rewritten to the INCREMENT, because the card reads as
 * a sum: Ultra under "Everything from Pro, plus:" must say 2,000 credits, not
 * 3,000. Pro's 1,000 is already counted by the line above, and 1,000 + 2,000
 * is the 3,000 the plan actually grants. Caps (courses) and boolean flags are
 * not additive. A limit replaces the one below it, so they keep their own
 * total, which is what "Up to 10 courses" has to mean to be true.
 *
 * Items are matched on feature id AND interval so a one-off starter grant
 * (Free's 200 credits, `interval == null`) never cancels out a recurring one.
 */
export function itemsAddedOver(
  items: ProductItem[],
  previous: Product | undefined,
): ProductItem[] {
  if (!previous) return items;
  return items.flatMap((item) => {
    const prior = previous.items.find(
      (p) => p.feature_id === item.feature_id && p.interval === item.interval,
    );
    if (!prior) return [item];
    if (item.included_usage === "inf") {
      return prior.included_usage === "inf" ? [] : [item];
    }
    if (prior.included_usage === "inf") return [];
    const total = Number(item.included_usage ?? 0);
    const alreadyIncluded = Number(prior.included_usage ?? 0);
    if (total <= alreadyIncluded) return [];
    return [
      isFeatureConsumable(item.feature_id ?? "") === true
        ? { ...item, included_usage: total - alreadyIncluded }
        : item,
    ];
  });
}

/**
 * Store builds must not show plans or prices (Play/App Store payment
 * policies), the shell renders nothing wherever a pricing table would be.
 */
export default function PricingTable(
  props: React.ComponentProps<typeof PricingTableInner>,
) {
  const isNative = useIsNativeApp();
  if (isNative) return null;
  return <PricingTableInner {...props} />;
}

function PricingTableInner({
  productDetails,
  carouselItemClassName,
}: {
  productDetails?: ProductDetails[];
  /** Overrides the per-card carousel basis classes (how many cards are
   *  visible side by side at each breakpoint). The home-header upgrade
   *  dialog narrows the cards so all three tiers fit on large screens. */
  carouselItemClassName?: string;
}) {
  const t = useTranslations("Pricing");
  const { customer, checkout, isLoading: isCustomerLoading } = useCustomer({
    errorOnNotFound: false,
    expand: ["trials_used"],
  });
  const trialState = getTrialState(customer);
  const { purchasePlan } = useNewPlanCheckout();
  const showCheckoutError = useCheckoutErrorToast();

  // NOTE: passing `productDetails` to usePricingTable FILTERS the table to
  // only the listed products. Don't use it for display tweaks.
  const { products: rawProducts, isLoading: isProductsLoading, error, refetch } = usePricingTable({ productDetails });

  // Stable display order: Free first, then paid plans by ascending price.
  // Autumn returns products in dashboard order, which is not guaranteed
  // to be Free → Basic → Pro.
  const products = rawProducts
    ?.slice()
    .sort((a, b) => productSortPrice(a) - productSortPrice(b));

  // The interval toggle defaults to the billing interval of the plan the
  // user is currently on (monthly plan → Monthly view, annual plan →
  // Annual view), and to Annual for users without a paid plan. The user's
  // manual toggle always wins. Only renders when both month and year
  // products exist (see `multiInterval` below).
  // Normalized once here and carried through context, so no component
  // downstream has to know which Autumn payload family it is holding.
  const customerPlans = normalizePlans(customer);
  const currentPaidProduct = findCurrentPaidPlan(customerPlans);
  const currentIntervalGroup = rawProducts?.find(
    (p) => p.id === currentPaidProduct?.planId,
  )?.properties?.interval_group;
  const [isAnnualOverride, setIsAnnualOverride] = useState<boolean | null>(null);
  const isAnnual =
    isAnnualOverride ??
    (currentIntervalGroup ? currentIntervalGroup === "year" : true);

  const hasRefetchedRef = useRef(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;

  useEffect(() => {
    if (customer && !hasRefetchedRef.current) {
      hasRefetchedRef.current = true;
      setIsRefetching(true);
      Promise.resolve(refetch()).finally(() => setIsRefetching(false));
    }
  }, [customer, refetch]);

  useEffect(() => {
    if (error && retryCount < MAX_RETRIES) {
      const timeout = setTimeout(() => {
        setRetryCount((c) => c + 1);
        refetch();
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [error, retryCount, refetch]);

  useEffect(() => {
    if (!error && products) {
      setRetryCount(0);
    }
  }, [error, products]);

  const isRetrying = error && retryCount < MAX_RETRIES;

  if (isCustomerLoading || isProductsLoading || isRefetching || isRetrying) {
    return (
      <div className="w-full h-full flex justify-center items-center min-h-[300px]">
        <Loader2 className="w-6 h-6 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex flex-col justify-center items-center gap-3 min-h-[300px]">
        <span className="text-sm text-muted-foreground">{t("error")}</span>
        <Button variant="ghost" size="sm" onClick={() => { setRetryCount(0); refetch(); }}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const intervals = Array.from(
    new Set(
      products?.map((p) => p.properties?.interval_group).filter((i) => !!i)
    )
  );

  const multiInterval = intervals.length > 1;

  const intervalFilter = (product: Product) => {
    if (!product.properties?.interval_group) {
      return true;
    }

    if (multiInterval) {
      if (isAnnual) {
        return product.properties?.interval_group === "year";
      } else {
        return product.properties?.interval_group === "month";
      }
    }

    return true;
  };

  const visibleProducts = products?.filter(intervalFilter) ?? [];
  // Open the carousel on the recommended plan (e.g. Pro) so it isn't
  // off-screen on viewports that fit fewer cards than there are plans.
  const startIndex = Math.max(
    0,
    visibleProducts.findIndex((p) => p.display?.recommend_text),
  );

  return (
    <div className={cn("root")}>
      {products && (
        <PricingTableContainer
          products={products}
          customerProducts={customerPlans}
          trialEligible={trialState.trialEligible}
          isAnnualToggle={isAnnual}
          setIsAnnualToggle={setIsAnnualOverride}
          multiInterval={multiInterval}
          startIndex={startIndex}
          itemClassName={carouselItemClassName}
>
          {visibleProducts.map((product, index) => {
            return (
              <PricingCard
                key={index}
                productId={product.id}
                buttonProps={{
                  disabled:
                    (product.scenario === "active" &&
                      !product.properties.updateable) ||
                    product.scenario === "scheduled",

                  onClick: async () => {
                    // The click, not the outcome. Pairing this with
                    // `checkout_redirected` below is what separates "didn't
                    // want it" from "wanted it and the flow broke".
                    capture(CLIENT_EVENTS.PLAN_CTA_CLICKED, {
                      product_id: product.id,
                      scenario: product.scenario,
                      trial_eligible: trialState.trialEligible,
                      on_trial: trialState.onTrial,
                    });
                    try {
                      if (product.id && customer) {
                        await purchasePlan({
                          productId: product.id,
                          trialState,
                          checkout,
                          dialog: CheckoutDialog,
                          freeTarget: product.properties?.is_free === true,
                        });
                      } else if (product.display?.button_url) {
                        window.open(product.display?.button_url, "_blank");
                      }
                    } catch (e) {
                      showCheckoutError(e, "pricingTable.select");
                    }
                  },
                }}
              />
            );
          })}
        </PricingTableContainer>
      )}
      {/* Paid plans are sold with Stripe as merchant of record, so the price
          on the card is the gross amount. VAT is carved out of it rather
          than added at checkout. Suppressed when the table is showing only
          the free plan, where there is no tax to speak of. */}
      {visibleProducts.some((p) => !p.properties?.is_free) && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t("taxNote")}
        </p>
      )}
    </div>
  );
}

const PricingTableContext = createContext<{
  isAnnualToggle: boolean;
  setIsAnnualToggle: (isAnnual: boolean) => void;
  products: Product[];
  customerProducts: AutumnPlan[];
  trialEligible: boolean;
  showFeatures: boolean;
    }>({
      isAnnualToggle: false,
      setIsAnnualToggle: () => {},
      products: [],
      customerProducts: [],
      trialEligible: false,
      showFeatures: true,
    });

export const usePricingTableContext = (componentName: string) => {
  const context = useContext(PricingTableContext);

  if (context === undefined) {
    throw new Error(`${componentName} must be used within <PricingTable />`);
  }

  return context;
};

export const PricingTableContainer = ({
  children,
  products,
  customerProducts = [],
  trialEligible = false,
  showFeatures = true,
  className,
  isAnnualToggle,
  setIsAnnualToggle,
  multiInterval,
  startIndex = 0,
  itemClassName,
}: {
  children?: React.ReactNode;
  products?: Product[];
  customerProducts?: AutumnPlan[];
  trialEligible?: boolean;
  showFeatures?: boolean;
  className?: string;
  isAnnualToggle: boolean;
  setIsAnnualToggle: (isAnnual: boolean) => void;
  multiInterval: boolean;
  /** Card the carousel opens on (e.g. the recommended plan). */
  startIndex?: number;
  /** Overrides the per-card basis classes (cards visible per breakpoint). */
  itemClassName?: string;
}) => {
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  if (!products) {
    throw new Error("products is required in <PricingTable />");
  }

  if (products.length === 0) {
    return <></>;
  }

  return (
    <PricingTableContext.Provider
      value={{
        isAnnualToggle,
        setIsAnnualToggle,
        products,
        customerProducts,
        trialEligible,
        showFeatures,
      }}
    >
      <div className={cn("flex items-center flex-col", className)}>
        {multiInterval && (
          <AnnualSwitch
            isAnnualToggle={isAnnualToggle}
            setIsAnnualToggle={setIsAnnualToggle}
          />
        )}
        <div className="w-full">
          <Carousel
            setApi={setCarouselApi}
            opts={{ align: "start", loop: false, startIndex }}
            className="w-full"
          >
            <CarouselContent>
              {React.Children.map(children, (child) => (
                <CarouselItem
                  className={
                    itemClassName ??
                    "basis-[85%] sm:basis-[70%] md:basis-[50%]"
                  }
                >
                  {child}
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
          <CarouselDots api={carouselApi} className="mt-3" />
        </div>
      </div>
    </PricingTableContext.Provider>
  );
};

interface PricingCardProps {
  productId: string;
  showFeatures?: boolean;
  className?: string;
  onButtonClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  buttonProps?: React.ComponentProps<"button">;
}

export const PricingCard = ({
  productId,
  className,
  buttonProps,
}: PricingCardProps) => {
  const t = useTranslations("Pricing");
  const tFeatures = useTranslations("Features");
  const locale = useLocale();
  const { products, showFeatures, customerProducts, trialEligible } =
    usePricingTableContext("PricingCard");

  const product = products.find((p) => p.id === productId);

  if (!product) {
    throw new Error(`Product with id ${productId} not found`);
  }

  const { name, display: productDisplay } = product;

  const { buttonText } = getPricingTableContent(
    product,
    t,
    trialEligible,
  );

  // Autumn labels plan switches by comparing raw prices, which misfires
  // across billing intervals (monthly Pro → Basic Annual reads as
  // "upgrade" because €72 > €16). When the tiers actually differ, relabel
  // the button from the tier comparison instead.
  const currentPaidProduct = findCurrentPaidPlan(customerProducts);
  const currentProduct = currentPaidProduct
    ? products.find((p) => p.id === currentPaidProduct.planId)
    : undefined;
  let finalButtonText = buttonText;
  if (
    currentProduct &&
    currentProduct.id !== product.id &&
    !product.properties?.is_free &&
    (product.scenario === "upgrade" || product.scenario === "downgrade")
  ) {
    const cardTier = paidTierRank(product, products);
    const currentTier = paidTierRank(currentProduct, products);
    if (cardTier !== -1 && currentTier !== -1 && cardTier !== currentTier) {
      finalButtonText = t(cardTier > currentTier ? "upgrade" : "downgrade");
    }
  }

  const isRecommended = productDisplay?.recommend_text ? true : false;
  const intervalGroup = product.properties?.interval_group;

  // Plan taglines come from our own i18n rather than Autumn's
  // `display.description`, which is a single unlocalized dashboard string and
  // would differ between a plan and its `_annual` variant. Falls back to
  // whatever Autumn returns for any plan we have no copy for.
  const basePlanId = product.id.replace(/_annual$/, "");
  const descriptionKey = `planDescriptions.${basePlanId}`;
  const planDescription = t.has(descriptionKey)
    ? t(descriptionKey)
    : productDisplay?.description;

  // Annual plans are displayed as their effective per-month price, with
  // the billed-annually total as a subline.
  const annualBasePrice =
    !product.properties?.is_free && intervalGroup === "year"
      ? product.items[0]?.price
      : undefined;
  const formatEur = (amount: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  const annualMonthlyPrice =
    typeof annualBasePrice === "number"
      ? formatEur(annualBasePrice / 12)
      : undefined;

  const periodLabel =
    !product.properties?.is_free && intervalGroup
      ? intervalGroup === "year" && !annualMonthlyPrice
        ? t("perYear")
        : t("perMonth")
      : undefined;

  const mainPriceDisplay = product.properties?.is_free
    ? {
      primary_text: t("free"),
    }
    : annualMonthlyPrice
      ? { primary_text: annualMonthlyPrice }
      : product.items[0].display;

  // Paid plans lead with their price item; the rest are entitlements.
  const allFeatureItems = product.properties?.is_free
    ? product.items
    : product.items.slice(1);

  // Each card lists only what it adds over the tier below, under an
  // "Everything from <lower tier>, plus:" line. Autumn's own
  // `display.everything_from` is a dashboard string that has to be kept in
  // sync by hand, so it is only a fallback for plans with no tier below them.
  const lowerTier = previousTier(product, products);
  const everythingFrom = lowerTier
    ? lowerTier.display?.name || lowerTier.name
    : product.display?.everything_from;
  const featureItems = itemsAddedOver(allFeatureItems, lowerTier);

  return (
    <div
      className={cn(
        // `relative` anchors the absolutely-positioned RecommendedBadge to
        // this card. The recommended emphasis must not shift layout
        // (translate/height tricks get clipped inside the Carousel), so it
        // is border/shadow only.
        "relative w-full h-full py-6 text-foreground border rounded-lg shadow-sm max-w-xl overflow-hidden",
        isRecommended &&
          "border-primary/50 shadow-lg dark:shadow-zinc-800/80 bg-secondary/40",
        className
      )}
    >
      {productDisplay?.recommend_text && (
        <RecommendedBadge recommended={productDisplay?.recommend_text} />
      )}
      <div className="flex flex-col h-full flex-grow">
        <div className="h-full">
          <div className="flex flex-col">
            <div className="pb-4">
              <h2 className="text-2xl font-semibold px-6 truncate">
                {productDisplay?.name || name}
              </h2>
              {planDescription && (
                <div className="text-sm text-muted-foreground px-6 h-8">
                  <p className="line-clamp-2">{planDescription}</p>
                </div>
              )}
            </div>
            <div className="mb-2">
              <h3 className="font-semibold h-16 flex flex-col justify-center px-6 border-y mb-4 bg-secondary/40">
                <div className="line-clamp-2">
                  {mainPriceDisplay?.primary_text}{" "}
                  {(periodLabel ?? mainPriceDisplay?.secondary_text) && (
                    <span className="font-normal text-muted-foreground mt-1">
                      {periodLabel ?? mainPriceDisplay?.secondary_text}
                    </span>
                  )}
                </div>
                {typeof annualBasePrice === "number" && (
                  <p className="text-xs font-normal text-muted-foreground">
                    {t("billedAnnually", { price: formatEur(annualBasePrice) })}
                  </p>
                )}
              </h3>
            </div>
            {/* Trial badge only when:
                 - the product itself offers a trial,
                 - this card is one the viewer can fresh-subscribe to
                   (scenario `"new"` for users with no plan record,
                   `"upgrade"` for users on the auto-default free plan
                   moving to a paid tier, both mean "not currently on
                   this card"; "active"/"scheduled"/"renew"/"cancel"
                   indicate the viewer is on or scheduled-onto this
                   card and should NOT see the trial promo), AND
                 - the viewer is trial-eligible: never trialed any plan
                   (per Autumn's trials_used record) and not on a paid
                   plan, no trial promos while trialing, paying, or
                   after a past trial. */}
            {product.properties?.has_trial &&
              (product.scenario === "new" ||
                product.scenario === "upgrade") &&
              trialEligible && (
              <div className="px-6 mb-4">
                <div
                  data-testid="pricing-trial-badge"
                  className="rounded-md bg-primary/10 text-primary border border-primary/20 px-3 py-2 text-sm font-semibold text-center"
                >
                  {t("freeTrialBadge", {
                    days: product.free_trial?.length ?? 7,
                  })}
                </div>
              </div>
            )}
          </div>
          {showFeatures && (featureItems.length > 0 || everythingFrom) && (
            <div className="flex-grow px-6 mb-6">
              <PricingFeatureList
                items={featureItems}
                everythingFrom={everythingFrom}
                extraFeatureKeys={EXTRA_PLAN_FEATURES[basePlanId]}
                tFeatures={tFeatures}
              />
            </div>
          )}
        </div>
        <div className="px-6">
          <PricingCardButton
            data-testid={`pricing-card-cta-${productId}`}
            recommended={productDisplay?.recommend_text ? true : false}
            {...buttonProps}
          >
            {productDisplay?.button_text || finalButtonText}
          </PricingCardButton>
        </div>
      </div>
    </div>
  );
};

const FeatureBullet = ({
  label,
  secondary,
}: {
  label: React.ReactNode;
  secondary?: string;
}) => (
  <div className="flex items-start gap-2 text-sm">
    <div className="flex flex-col">
      <span>{label}</span>
      {secondary && (
        <span className="text-sm text-muted-foreground">{secondary}</span>
      )}
    </div>
  </div>
);

export const PricingFeatureList = ({
  items,
  everythingFrom,
  extraFeatureKeys,
  className,
  tFeatures,
}: {
  items: ProductItem[];
  everythingFrom?: string;
  /** Display-only bullets (see EXTRA_PLAN_FEATURES), not Autumn features. */
  extraFeatureKeys?: string[];
  className?: string;
  tFeatures?: ReturnType<typeof useTranslations>;
}) => {
  const t = useTranslations("Pricing");

  const getFeatureLabel = (item: ProductItem): string | undefined => {
    if (tFeatures && item.feature_id && item.feature_id in FEATURE_META) {
      const i18nKey = getFeatureI18nKey(item.feature_id);
      const override = getFeatureDisplayCount(item.feature_id);
      const included = override ?? item.included_usage ?? 0;
      const isUnlimited =
        included === Infinity ||
        included === Number.POSITIVE_INFINITY ||
        (isFeatureDisplayedAsUnlimited(item.feature_id) && Number(item.included_usage ?? 0) >= 19000);
      if (isUnlimited) {
        return tFeatures(`${i18nKey}.pricingLabelUnlimited`);
      }
      // Consumable items without a reset interval are one-off starter
      // grants (e.g. "300 sentences to start", "200 credits to start").
      if (isFeatureConsumable(item.feature_id) === true && item.interval == null) {
        return tFeatures(`${i18nKey}.pricingLabelOneOff`, { count: Number(included) });
      }
      return tFeatures(`${i18nKey}.pricingLabel`, { count: Number(included) });
    }
    return item.display?.primary_text;
  };

  return (
    <div className={cn("flex-grow", className)}>
      {everythingFrom && (
        <p className="text-sm mb-4">
          {t("everythingFrom", { planName: everythingFrom })}
        </p>
      )}
      <div className="space-y-3">
        {items.filter((item) => !isFeatureHidden(item.feature_id ?? '')).map((item, index) => (
          <FeatureBullet
            key={index}
            label={getFeatureLabel(item)}
            secondary={item.display?.secondary_text}
          />
        ))}
        {extraFeatureKeys?.map((key) => (
          <FeatureBullet key={key} label={t(key)} />
        ))}
        {/* Not a metered Autumn item. Every plan has it, so it only belongs
            on the base card. Higher tiers inherit it via "Everything from". */}
        {!everythingFrom && (
          <FeatureBullet
            label={tFeatures ? tFeatures("detailedStatistics.pricingLabel") : "Detailed statistics"}
          />
        )}
      </div>
    </div>
  );
};

export interface PricingCardButtonProps extends React.ComponentProps<"button"> {
  recommended?: boolean;
  buttonUrl?: string;
}

export const PricingCardButton = React.forwardRef<
  HTMLButtonElement,
  PricingCardButtonProps
>(({ recommended, children, className, onClick, ...props }, ref) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    setLoading(true);
    try {
      await onClick?.(e);
    } catch (error) {
      reportError(error, { op: 'pricingTableAction' });
    } finally {
      setLoading(false);
    }
  };

  // One element description rendered in both hover layers. Reusing the same
  // element object in two tree positions is legal React and keeps the DOM
  // identical to spelling the pair out twice.
  const label = (
    <>
      <span>{children}</span>
      <span className="text-sm">→</span>
    </>
  );

  return (
    <Button
      className={cn(
        "w-full py-3 px-4 group overflow-hidden relative transition-all duration-300 hover:brightness-90 border rounded-lg",
        className
      )}
      {...props}
      variant={recommended ? "default" : "secondary"}
      ref={ref}
      disabled={loading || props.disabled}
      onClick={handleClick}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <div className="flex items-center justify-between w-full transition-transform duration-300 group-hover:translate-y-[-130%]">
            {label}
          </div>
          <div className="flex items-center justify-between w-full absolute px-4 translate-y-[130%] transition-transform duration-300 group-hover:translate-y-0 mt-2 group-hover:mt-0">
            {label}
          </div>
        </>
      )}
    </Button>
  );
});
PricingCardButton.displayName = "PricingCardButton";

export const AnnualSwitch = ({
  isAnnualToggle,
  setIsAnnualToggle,
}: {
  isAnnualToggle: boolean;
  setIsAnnualToggle: (isAnnual: boolean) => void;
}) => {
  const t = useTranslations("Pricing");
  return (
    <div className="flex items-center space-x-2 mb-4">
      <span className="text-sm text-muted-foreground">{t("monthly")}</span>
      <Switch
        id="annual-billing"
        checked={isAnnualToggle}
        onCheckedChange={setIsAnnualToggle}
      />
      <span className="text-sm text-muted-foreground">{t("annual")}</span>
      <span className="rounded-full bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-xs font-semibold">
        {t("annualSaveHint")}
      </span>
    </div>
  );
};

export const RecommendedBadge = ({ recommended }: { recommended: string }) => {
  return (
    <div className="bg-secondary absolute border text-muted-foreground text-sm font-medium px-3 top-[-1px] right-[-1px] rounded-bl-lg">
      {recommended}
    </div>
  );
};

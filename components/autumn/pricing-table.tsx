import React from "react";

import { useCustomer, usePricingTable, ProductDetails } from "autumn-js/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import CheckoutDialog from "@/components/autumn/checkout-dialog";
import { getPricingTableContent } from "@/lib/autumn/pricing-table-content";
import { hasPaidPlanHistory, type CustomerProductLite } from "@/lib/autumn/trial-eligibility";
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

/** Sort key for plan cards: Free first, then paid plans by ascending price. */
function productSortPrice(product: Product): number {
  if (product.properties?.is_free) return -1;
  const price = product.items[0]?.price;
  return typeof price === "number" ? price : 0;
}

/**
 * Rank of a paid plan within its own interval group (0 = cheapest tier).
 * Used to compare tiers ACROSS billing intervals, where raw prices mislead:
 * Basic Annual (€72) costs more than a month of Pro (€16), so Autumn labels
 * it an "upgrade" — but tier-wise it is a downgrade.
 */
function paidTierRank(product: Product, products: Product[]): number {
  return products
    .filter(
      (p) =>
        !p.properties?.is_free &&
        p.properties?.interval_group === product.properties?.interval_group,
    )
    .sort((a, b) => productSortPrice(a) - productSortPrice(b))
    .findIndex((p) => p.id === product.id);
}

export default function PricingTable({
  productDetails,
  excludeFreePlan = false,
  recommendedProductIds,
}: {
  productDetails?: ProductDetails[];
  /** When true, drop products whose `properties.is_free` is set. Used by the
   *  onboarding flow where the user must commit to a paid tier to finish. */
  excludeFreePlan?: boolean;
  /** Product ids to mark with the localized "Most Popular" badge (e.g. the
   *  onboarding plan picker highlights Pro). Injected after the fetch —
   *  `productDetails` cannot be used for this because passing it FILTERS
   *  the table to only the listed products. */
  recommendedProductIds?: string[];
}) {
  const t = useTranslations("Pricing");
  const { customer, checkout, isLoading: isCustomerLoading } = useCustomer({ errorOnNotFound: false });

  // NOTE: passing `productDetails` to usePricingTable FILTERS the table to
  // only the listed products — don't use it for display tweaks.
  const { products: rawProducts, isLoading: isProductsLoading, error, refetch } = usePricingTable({ productDetails });

  // Stable display order: Free first, then paid plans by ascending price.
  // Autumn returns products in dashboard order, which is not guaranteed
  // to be Free → Basic → Pro.
  const products = rawProducts
    ?.filter((p) => !excludeFreePlan || !p.properties?.is_free)
    .map((p) =>
      recommendedProductIds?.includes(p.id) && !p.display?.recommend_text
        ? { ...p, display: { ...p.display, recommend_text: t("mostPopular") } }
        : p,
    )
    .sort((a, b) => productSortPrice(a) - productSortPrice(b));

  // The interval toggle defaults to the billing interval of the plan the
  // user is currently on (monthly plan → Monthly view, annual plan →
  // Annual view), and to Annual for users without a paid plan. The user's
  // manual toggle always wins. Only renders when both month and year
  // products exist (see `multiInterval` below).
  const currentPaidProduct = (
    customer?.products as CustomerProductLite[] | undefined
  )?.find((cp) => !cp.is_default && !cp.is_add_on && cp.status !== "expired");
  const currentIntervalGroup = rawProducts?.find(
    (p) => p.id === currentPaidProduct?.id,
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

  return (
    <div className={cn("root")}>
      {products && (
        <PricingTableContainer
          products={products}
          customerProducts={
            (customer?.products ?? []) as CustomerProductLite[]
          }
          isAnnualToggle={isAnnual}
          setIsAnnualToggle={setIsAnnualOverride}
          multiInterval={multiInterval}
        >
          {products.filter(intervalFilter).map((product, index) => (
            <PricingCard
              key={index}
              productId={product.id}
              buttonProps={{
                disabled:
                  (product.scenario === "active" &&
                    !product.properties.updateable) ||
                  product.scenario === "scheduled",

                onClick: async () => {
                  if (product.id && customer) {
                    await checkout({
                      productId: product.id,
                      dialog: CheckoutDialog,
                      // Paying (or previously paying) customers never get
                      // another trial, on any plan. Autumn only dedupes
                      // trials per-plan, so this closes the cross-plan hole.
                      ...(hasPaidPlanHistory(
                        customer.products as CustomerProductLite[] | undefined,
                      )
                        ? { freeTrial: false }
                        : {}),
                    });
                  } else if (product.display?.button_url) {
                    window.open(product.display?.button_url, "_blank");
                  }
                },
              }}
            />
          ))}
        </PricingTableContainer>
      )}
    </div>
  );
}

const PricingTableContext = createContext<{
  isAnnualToggle: boolean;
  setIsAnnualToggle: (isAnnual: boolean) => void;
  products: Product[];
  customerProducts: CustomerProductLite[];
  showFeatures: boolean;
    }>({
      isAnnualToggle: false,
      setIsAnnualToggle: () => {},
      products: [],
      customerProducts: [],
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
  showFeatures = true,
  className,
  isAnnualToggle,
  setIsAnnualToggle,
  multiInterval,
}: {
  children?: React.ReactNode;
  products?: Product[];
  customerProducts?: CustomerProductLite[];
  showFeatures?: boolean;
  className?: string;
  isAnnualToggle: boolean;
  setIsAnnualToggle: (isAnnual: boolean) => void;
  multiInterval: boolean;
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
            opts={{ align: "start", loop: false }}
            className="w-full"
          >
            <CarouselContent>
              {React.Children.map(children, (child) => (
                <CarouselItem className="basis-[85%] sm:basis-[70%] md:basis-[50%]">
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
  const { products, showFeatures, customerProducts } =
    usePricingTableContext("PricingCard");

  const product = products.find((p) => p.id === productId);

  // Trial badge gating: hide as soon as the user has ANY paid plan
  // attached, including one they are still trialing — someone already on
  // a plan must never be offered a trial on another plan. The same
  // predicate gates `freeTrial: false` on every checkout/attach call
  // (see lib/autumn/trial-eligibility.ts).
  const userHasPaidPlan = hasPaidPlanHistory(customerProducts);

  if (!product) {
    throw new Error(`Product with id ${productId} not found`);
  }

  const { name, display: productDisplay } = product;

  const { buttonText } = getPricingTableContent(
    product,
    t,
    userHasPaidPlan,
  );

  // Autumn labels plan switches by comparing raw prices, which misfires
  // across billing intervals (monthly Pro → Basic Annual reads as
  // "upgrade" because €72 > €16). When the tiers actually differ, relabel
  // the button from the tier comparison instead.
  const currentPaidProduct = customerProducts.find(
    (cp) => !cp.is_default && !cp.is_add_on && cp.status !== "expired",
  );
  const currentProduct = currentPaidProduct
    ? products.find((p) => p.id === currentPaidProduct.id)
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

  const featureItems = product.properties?.is_free
    ? product.items
    : product.items.slice(1);

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
              {productDisplay?.description && (
                <div className="text-sm text-muted-foreground px-6 h-8">
                  <p className="line-clamp-2">
                    {productDisplay?.description}
                  </p>
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
                   moving to a paid tier — both mean "not currently on
                   this card"; "active"/"scheduled"/"renew"/"cancel"
                   indicate the viewer is on or scheduled-onto this
                   card and should NOT see the trial promo), AND
                 - the viewer has no paid plan at all (trialing counts
                   as having one — no trial offers while already on a
                   plan).
                The `userHasPaidPlan` guard is the safety net: a Pro
                viewer looking at Basic could see `scenario ===
                "downgrade"` (also non-current), so the third condition
                prevents the trial promo leaking regardless of how
                Autumn labels the other card. */}
            {product.properties?.has_trial &&
              (product.scenario === "new" ||
                product.scenario === "upgrade") &&
              !userHasPaidPlan && (
              <div className="px-6 mb-4">
                <div className="rounded-md bg-primary/10 text-primary border border-primary/20 px-3 py-2 text-sm font-semibold text-center">
                  {t("freeTrialBadge", {
                    days: product.free_trial?.length ?? 7,
                  })}
                </div>
              </div>
            )}
          </div>
          {showFeatures && featureItems.length > 0 && (
            <div className="flex-grow px-6 mb-6">
              <PricingFeatureList
                items={featureItems}
                everythingFrom={product.display?.everything_from}
                tFeatures={tFeatures}
              />
            </div>
          )}
        </div>
        <div className="px-6">
          <PricingCardButton
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

export const PricingFeatureList = ({
  items,
  everythingFrom,
  className,
  tFeatures,
}: {
  items: ProductItem[];
  everythingFrom?: string;
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
        {items.filter((item) => !isFeatureHidden(item.feature_id ?? '')).map((item, index) => {
          const label = getFeatureLabel(item);
          return (
            <div
              key={index}
              className="flex items-start gap-2 text-sm"
            >
              <div className="flex flex-col">
                <span>{label}</span>
                {item.display?.secondary_text && (
                  <span className="text-sm text-muted-foreground">
                    {item.display?.secondary_text}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex items-start gap-2 text-sm">
          <div className="flex flex-col">
            <span>{tFeatures ? tFeatures("detailedStatistics.pricingLabel") : "Detailed statistics"}</span>
          </div>
        </div>
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
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

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
            <span>{children}</span>
            <span className="text-sm">→</span>
          </div>
          <div className="flex items-center justify-between w-full absolute px-4 translate-y-[130%] transition-transform duration-300 group-hover:translate-y-0 mt-2 group-hover:mt-0">
            <span>{children}</span>
            <span className="text-sm">→</span>
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
    <div className="bg-secondary absolute border text-muted-foreground text-sm font-medium lg:rounded-full px-3 lg:py-0.5 lg:top-4 lg:right-4 top-[-1px] right-[-1px] rounded-bl-lg">
      {recommended}
    </div>
  );
};

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import PricingTable from '@/components/autumn/pricing-table';

/**
 * Step 14 — Plan picker (and onboarding finale).
 *
 * Combines the soft "thank you for joining" beat with the pricing table.
 * All plans are shown, including the auto-enabled Free plan.
 *
 * The 7-day free trial is configured in autumn.config.ts for Basic + Pro
 * (and their annual variants); the client just calls `checkout({productId})`.
 * If the user closes the checkout dialog without purchasing, "Maybe later"
 * leaves them on the auto-enabled Free plan.
 */
interface Props {
  onContinue: () => void;
}

export function PlanPickStep({ onContinue }: Props) {
  const t = useTranslations('Onboarding.planPick');
  return (
    <div
      data-testid="onboarding-step-plan-pick"
      className="h-full overflow-y-auto animate-in fade-in duration-300"
    >
      <div className="min-h-full flex flex-col">
        <div className="text-center pt-6 pb-3 shrink-0 px-4">
          <Image
            src="/icons/icon.svg"
            alt="Flexling"
            width={56}
            height={56}
            className="rounded-2xl mx-auto mb-3"
            priority
          />
          <h2 className="text-2xl md:text-3xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{t('subtitle')}</p>
        </div>
        <div className="flex-1 min-h-0 px-2 md:px-4">
          <PricingTable
            recommendedProductIds={['pro', 'pro_annual']}
            // At most 3 cards side by side during onboarding.
            carouselItemClassName="basis-[85%] sm:basis-[70%] md:basis-[45%] lg:basis-1/3"
            onFreePlanSelect={onContinue}
          />
        </div>
        <div className="shrink-0 text-center py-4 px-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onContinue}
            data-testid="plan-pick-skip"
            className="text-muted-foreground hover:text-muted-foreground/80"
          >
            {t('skip')}
          </Button>
        </div>
      </div>
    </div>
  );
}

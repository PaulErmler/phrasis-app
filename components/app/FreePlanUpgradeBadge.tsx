'use client';

import { useState } from 'react';
import { useCustomer } from 'autumn-js/react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sparkles } from 'lucide-react';
import PricingTable from '@/components/autumn/pricing-table';
import { getTrialState } from '@/lib/autumn/trial-eligibility';
import { useIsNativeApp } from '@/hooks/use-native-app';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { SilentErrorBoundary } from '@/components/app/ViewErrorBoundary';

/**
 * Home-header plan indicator for free users: a muted "Free" pill plus an
 * Upgrade button that opens the pricing table in a dialog right there, no
 * navigation away from home. This is the app's standing upgrade entry point
 * now that onboarding shows no plan step and no paywall. Usage-triggered
 * dialogs plus this badge are the whole funnel.
 *
 * Renders nothing while the customer is loading (no flash for paid users),
 * for paid/trialing customers, and on native store builds (no purchase UI
 * allowed, same policy as PricingTable).
 */
export function FreePlanUpgradeBadge() {
  // The badge renders in the app header, outside every ViewErrorBoundary.
  // A throw from the billing SDK would otherwise unwind to app/error.tsx
  // and replace the whole shell. An upgrade affordance is never worth that.
  return (
    <SilentErrorBoundary boundary="home.freePlanUpgradeBadge">
      <FreePlanUpgradeBadgeInner />
    </SilentErrorBoundary>
  );
}

function FreePlanUpgradeBadgeInner() {
  const t = useTranslations('AppPage');
  const isNative = useIsNativeApp();
  const [open, setOpen] = useState(false);
  const { customer, isLoading } = useCustomer({
    errorOnNotFound: false,
    expand: ['trials_used'],
  });

  if (isNative || isLoading || !customer) return null;
  const trialState = getTrialState(customer);
  if (trialState.hasPaidPlan || trialState.onTrial) return null;

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      data-testid="home-free-plan-badge"
    >
      <span className="hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
        {t('freePlan')}
      </span>
      <Button
        size="sm"
        className="h-7 gap-1 px-2.5 text-xs"
        data-testid="home-upgrade-button"
        onClick={() => {
          capture(CLIENT_EVENTS.PLAN_CTA_CLICKED, {
            product_id: 'none',
            source: 'home_header',
          });
          setOpen(true);
        }}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {t('upgrade')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* Wide + scrollable: the pricing table renders a card carousel that
            wants horizontal room on desktop and vertical room on mobile. */}
        <DialogContent
          className="max-w-[min(64rem,calc(100vw-2rem))] sm:max-w-[min(64rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] overflow-y-auto"
          data-testid="home-upgrade-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t('upgrade')}</DialogTitle>
          </DialogHeader>
          {/* Narrower cards than the settings page so all three tiers sit
              side by side on large screens instead of a 2-up carousel. */}
          <PricingTable carouselItemClassName="basis-[85%] sm:basis-[60%] md:basis-[45%] lg:basis-1/3" />
        </DialogContent>
      </Dialog>
    </div>
  );
}

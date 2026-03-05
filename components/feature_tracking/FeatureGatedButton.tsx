'use client';

import { useState, type ComponentProps } from 'react';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FeatureBadge } from './FeatureBadge';
import { useFeatureQuota } from './useFeatureQuota';
import PaywallDialog from '@/components/autumn/paywall-dialog';

interface FeatureGatedButtonProps
  extends Omit<ComponentProps<typeof Button>, 'onClick'> {
  featureId: string;
  onAction: () => void;
  /** Label shown when the feature limit is reached. Defaults to "Upgrade". */
  lockedLabel?: string;
  /** Hide the inline FeatureBadge. */
  hideBadge?: boolean;
}

/**
 * A button that is aware of the user's quota for a given feature.
 *
 * - While quota remains: renders normally with an optional inline badge.
 * - When quota is exhausted: renders as an "Upgrade" button with a lock icon
 *   that opens the Autumn paywall dialog on click.
 */
export function FeatureGatedButton({
  featureId,
  onAction,
  lockedLabel,
  hideBadge = false,
  children,
  className,
  ...buttonProps
}: FeatureGatedButtonProps) {
  const t = useTranslations('FeatureTracking');
  const { isAvailable, isLoading } = useFeatureQuota(featureId);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const label = lockedLabel ?? t('upgrade');

  if (!isAvailable && !isLoading) {
    return (
      <>
        <Button
          {...buttonProps}
          className={className}
          onClick={() => setPaywallOpen(true)}
        >
          <Lock className="h-4 w-4" />
          {label}
        </Button>
        {paywallOpen && (
          <PaywallDialog
            open={paywallOpen}
            setOpen={setPaywallOpen}
            featureId={featureId}
          />
        )}
      </>
    );
  }

  return (
    <Button {...buttonProps} className={className} onClick={onAction}>
      {children}
      {!hideBadge && <FeatureBadge featureId={featureId} />}
    </Button>
  );
}

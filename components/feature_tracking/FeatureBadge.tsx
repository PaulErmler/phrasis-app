'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { useFeatureQuota } from './useFeatureQuota';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import LowQuotaDialog from '@/components/autumn/low-quota-dialog';

interface FeatureBadgeProps {
  featureId: string;
  className?: string;
}

const LOW_BALANCE_THRESHOLD = 3;

/**
 * Displays a small badge showing the remaining quota for a feature.
 * Hidden while loading or when balance is above the threshold.
 * Shows "{balance} left" when low, "Limit reached" when 0.
 * Clicking opens a pricing dialog (low quota) or paywall (limit reached).
 */
export function FeatureBadge({ featureId, className }: FeatureBadgeProps) {
  const t = useTranslations('FeatureTracking');
  const { balance, unlimited, isLoading } = useFeatureQuota(featureId);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading || unlimited) return null;

  if (balance > LOW_BALANCE_THRESHOLD) return null;

  return (
    <>
      {balance > 0 ? (
        <Badge
          variant="secondary"
          className={`cursor-pointer text-amber-600 dark:text-amber-400 ${className ?? ''}`}
          onClick={() => setDialogOpen(true)}
        >
          {t('left', { balance })}
        </Badge>
      ) : (
        <Badge
          variant="destructive"
          className={`cursor-pointer ${className ?? ''}`}
          onClick={() => setDialogOpen(true)}
        >
          {t('limitReached')}
        </Badge>
      )}

      {dialogOpen && balance > 0 && (
        <LowQuotaDialog
          open={dialogOpen}
          setOpen={setDialogOpen}
          balance={balance}
          featureId={featureId}
        />
      )}

      {dialogOpen && balance <= 0 && (
        <PaywallDialog
          open={dialogOpen}
          setOpen={setDialogOpen}
          featureId={featureId}
        />
      )}
    </>
  );
}

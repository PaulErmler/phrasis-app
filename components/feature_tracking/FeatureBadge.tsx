'use client';

import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { useFeatureQuota } from './useFeatureQuota';

interface FeatureBadgeProps {
  featureId: string;
  className?: string;
}

/**
 * Displays a small badge showing the remaining quota for a feature.
 * Shows nothing while loading, "Unlimited" when unlimited,
 * "{balance} left" in green when available, "Limit reached" in red when 0.
 */
export function FeatureBadge({ featureId, className }: FeatureBadgeProps) {
  const t = useTranslations('FeatureTracking');
  const { balance, unlimited, isLoading } = useFeatureQuota(featureId);

  if (isLoading) return null;

  if (unlimited) {
    return (
      <Badge variant="secondary" className={className}>
        {t('unlimited')}
      </Badge>
    );
  }

  if (balance > 0) {
    return (
      <Badge
        variant="secondary"
        className={`text-green-600 dark:text-green-400 ${className ?? ''}`}
      >
        {t('left', { balance })}
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" className={className}>
      {t('limitReached')}
    </Badge>
  );
}

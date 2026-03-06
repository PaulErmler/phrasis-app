'use client';

import { useTranslations } from 'next-intl';
import { useFeatureQuota } from './useFeatureQuota';

interface FeatureQuotaDisplayProps {
  featureId: string;
  className?: string;
}

/**
 * Inline text showing "X / Y remaining" for a feature.
 * Shows nothing while loading, "Unlimited" when unlimited.
 */
export function FeatureQuotaDisplay({
  featureId,
  className,
}: FeatureQuotaDisplayProps) {
  const t = useTranslations('FeatureTracking');
  const { balance, included, unlimited, isLoading } =
    useFeatureQuota(featureId);

  if (isLoading) return null;

  if (unlimited) {
    return <span className={className}>{t('unlimited')}</span>;
  }

  return (
    <span className={className}>
      {t('remaining', { balance, included })}
    </span>
  );
}

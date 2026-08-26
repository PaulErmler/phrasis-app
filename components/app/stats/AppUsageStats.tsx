'use client';

import { useTranslations } from 'next-intl';

interface AppUsageStatsProps {
  manualCards: number;
  chatCards: number;
  chatMessages: number;
}

export function AppUsageStats({
  manualCards,
  chatCards,
  chatMessages,
}: AppUsageStatsProps) {
  const t = useTranslations('StatsPage');

  return (
    <div className="card-surface p-3">
      <p className="text-sm font-semibold text-muted-foreground mb-3">
        {t('appUsage')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-lg font-semibold tabular-nums">{manualCards}</p>
          <p className="text-muted-xs">{t('manualCards')}</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold tabular-nums">{chatCards}</p>
          <p className="text-muted-xs">{t('chatCards')}</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold tabular-nums">{chatMessages}</p>
          <p className="text-muted-xs">{t('chatMessages')}</p>
        </div>
      </div>
    </div>
  );
}

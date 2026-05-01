'use client';

import { useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import { PROGRESS_DISPLAY_INTERVAL } from '@/lib/constants/learning';

interface SessionProgressBarProps {
  dailyReviewsToday: number;
}

export function SessionProgressBar({ dailyReviewsToday }: SessionProgressBarProps) {
  const t = useTranslations('LearningMode.progressDisplay');
  const within = dailyReviewsToday % PROGRESS_DISPLAY_INTERVAL;
  const value = (within / PROGRESS_DISPLAY_INTERVAL) * 100;
  return (
    <div className="px-4 py-2">
      <Progress value={value} className="h-1.5" aria-label={t('progressToNextMilestone')} />
    </div>
  );
}

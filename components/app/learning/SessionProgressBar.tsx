'use client';

import { useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import { PROGRESS_DISPLAY_INTERVAL } from '@/lib/constants/learning';

interface SessionProgressBarProps {
  /** Cards rated since this learning session started (resets each new session). */
  sessionCardCount: number;
  /** Bar fills to 100% when sessionCardCount reaches this value, then wraps. */
  maxReviews?: number;
}

export function SessionProgressBar({
  sessionCardCount,
  maxReviews = PROGRESS_DISPLAY_INTERVAL,
}: SessionProgressBarProps) {
  const t = useTranslations('LearningMode.progressDisplay');
  const within = maxReviews > 0 ? sessionCardCount % maxReviews : 0;
  const value = maxReviews > 0 ? (within / maxReviews) * 100 : 0;
  return (
    <div className="px-4 py-2">
      <Progress value={value} className="h-1.5" aria-label={t('progressToNextMilestone')} />
    </div>
  );
}

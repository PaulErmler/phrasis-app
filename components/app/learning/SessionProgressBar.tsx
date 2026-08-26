'use client';

import { useTranslations } from 'next-intl';
import { Progress } from '@/components/ui/progress';
import { PROGRESS_DISPLAY_INTERVAL } from '@/lib/constants/learning';

interface SessionProgressBarProps {
  /** Counter the bar reflects. In normal mode this is `dailyReviewsToday`
   * (server-persisted, excludes radio) so the bar lines up exactly with when
   * the milestone celebration fires across reloads. In onboarding it's the
   * in-memory `sessionCardCount` (lesson-progress 0/10). */
  current: number;
  /** Bar fills to 100% when `current` reaches this value, then wraps. */
  max?: number;
}

export function SessionProgressBar({
  current,
  max = PROGRESS_DISPLAY_INTERVAL,
}: SessionProgressBarProps) {
  const t = useTranslations('LearningMode.progressDisplay');
  const within = max > 0 ? current % max : 0;
  const value = max > 0 ? (within / max) * 100 : 0;
  return (
    <div className="px-4 py-2">
      <Progress
        value={value}
        className="h-1.5"
        aria-label={t('progressToNextMilestone')}
      />
    </div>
  );
}

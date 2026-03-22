'use client';

import { useTranslations } from 'next-intl';
import { usePreloadedQuery, Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Flame, RotateCcw, MessageSquare, Clock } from 'lucide-react';
import { formatTimeMs } from '@/lib/formatTime';
import { StartLearningButton } from '@/components/app/StartLearningButton';

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <p className="stat-value leading-tight mt-1">{value}</p>
      <p className="text-muted-xs leading-tight mt-1">{label}</p>
    </div>
  );
}

export function ProgressStatsCard({
  preloadedCourseStats,
  onStartLearning,
  isNavigating,
}: {
  preloadedCourseStats: Preloaded<typeof api.features.courses.getCourseStats>;
  onStartLearning: () => void;
  isNavigating: boolean;
}) {
  const t = useTranslations('AppPage');
  const stats = usePreloadedQuery(preloadedCourseStats);

  const streak = stats?.currentStreak ?? 0;
  const reps = stats?.totalRepetitions ?? 0;
  const cards = stats?.totalCards ?? 0;
  const time = formatTimeMs(stats?.totalTimeMs ?? 0);

  return (
    <div className="card-surface p-4 space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <StatItem icon={Flame} label={t('stats.streak')} value={String(streak)} />
        <StatItem icon={RotateCcw} label={t('stats.reps')} value={String(reps)} />
        <StatItem
          icon={MessageSquare}
          label={t('stats.sentences')}
          value={String(cards)}
        />
        <StatItem icon={Clock} label={t('stats.time')} value={time} />
      </div>
      <StartLearningButton
        onStartLearning={onStartLearning}
        isNavigating={isNavigating}
      />
    </div>
  );
}

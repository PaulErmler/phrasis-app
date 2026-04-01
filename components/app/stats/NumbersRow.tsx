'use client';

import { useTranslations } from 'next-intl';
import { Flame, BookOpen, RotateCcw, MessageSquare, Clock, Target } from 'lucide-react';
import { formatTimeMs } from '@/lib/formatTime';

interface NumbersRowProps {
  streak: number;
  words: number;
  reviews: number;
  sentences: number;
  timeMs: number;
  accuracySum: number;
  accuracyCount: number;
  hasLearnedToday?: boolean;
}

function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-0.5">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      <p className="text-muted-xs leading-none">{label}</p>
    </div>
  );
}

export function NumbersRow({
  streak,
  words,
  reviews,
  sentences,
  timeMs,
  accuracySum,
  accuracyCount,
  hasLearnedToday,
}: NumbersRowProps) {
  const t = useTranslations('StatsPage');

  const accuracy = accuracyCount > 0 ? `${Math.round(accuracySum / accuracyCount)}%` : '--';

  const streakColor = hasLearnedToday
    ? 'var(--streak-active)'
    : streak > 0
      ? 'var(--accent-orange)'
      : undefined;

  return (
    <div className="card-surface p-3">
      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
        <div className="flex flex-col items-center text-center gap-0.5">
          <Flame className="h-3.5 w-3.5" style={{ color: streakColor ?? 'var(--muted-foreground)' }} />
          <p className="text-lg font-semibold tabular-nums leading-tight" style={{ color: streakColor }}>
            {streak}
          </p>
          <p className="text-muted-xs leading-none">{t('streak')}</p>
        </div>
        <StatCell
          icon={<BookOpen className="h-3.5 w-3.5" />}
          label={t('words')}
          value={words.toLocaleString()}
        />
        <StatCell
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label={t('reviews')}
          value={reviews.toLocaleString()}
        />
        <StatCell
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label={t('sentences')}
          value={sentences.toLocaleString()}
        />
        <StatCell
          icon={<Clock className="h-3.5 w-3.5" />}
          label={t('time')}
          value={formatTimeMs(timeMs)}
        />
        <StatCell
          icon={<Target className="h-3.5 w-3.5" />}
          label={t('accuracy')}
          value={accuracy}
        />
      </div>
    </div>
  );
}

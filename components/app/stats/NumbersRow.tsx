'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Flame, BookOpen, RotateCcw, MessageSquare, Clock, Target } from 'lucide-react';
import { formatTimeMs } from '@/lib/formatTime';
import { getLanguageByCode } from '@/lib/languages';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { useStatsSnapshot } from '@/hooks/use-stats-snapshot';
import { cn } from '@/lib/utils';

interface LanguageWordCount {
  language: string;
  words: number;
}

type StatsPeriod = 'day' | 'week' | 'month';
const STATS_PERIODS: StatsPeriod[] = ['day', 'week', 'month'];

interface NumbersRowProps {
  streak: number;
  words: number;
  reviews: number;
  sentences: number;
  timeMs: number;
  accuracySum: number;
  accuracyCount: number;
  hasLearnedToday?: boolean;
  languageWordCounts: LanguageWordCount[];
  todayReps?: number;
  todayNewCards?: number;
  todayTimeMs?: number;
  todayNewWords?: number;
  weekReps?: number;
  weekNewCards?: number;
  weekTimeMs?: number;
  weekNewWords?: number;
  monthReps?: number;
  monthNewCards?: number;
  monthTimeMs?: number;
  monthNewWords?: number;
}


function StatCell({
  icon,
  label,
  value,
  subDisplay,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subDisplay?: string | null;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-0.5" data-testid={testId}>
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      <p className="text-muted-xs leading-none">{label}</p>
      {subDisplay != null && (
        <p className="text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap">
          {subDisplay}
        </p>
      )}
    </div>
  );
}

function getLanguageFlag(code: string): string {
  const lang = getLanguageByCode(code);
  return lang?.flag ?? '🌐';
}

function WordsCell({ languageWordCounts, totalWords, t, subDisplay }: {
  languageWordCounts: LanguageWordCount[];
  totalWords: number;
  t: ReturnType<typeof useTranslations>;
  subDisplay?: string | null;
}) {
  const showFlags = languageWordCounts.length >= 2;

  if (!showFlags) {
    return (
      <StatCell
        icon={<BookOpen className="h-3.5 w-3.5" />}
        label={t('words')}
        value={totalWords.toLocaleString()}
        subDisplay={subDisplay}
        testId="stats-tile-words"
      />
    );
  }

  return (
    <div className="flex flex-col items-center text-center gap-0.5" data-testid="stats-tile-words">
      <div className="text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-0.5">
        {languageWordCounts.map((lw) => (
          <span key={lw.language} className="text-sm font-semibold tabular-nums leading-tight">
            {getLanguageFlag(lw.language)}{' '}
            {lw.words.toLocaleString()}
          </span>
        ))}
      </div>
      <p className="text-muted-xs leading-none">{t('words')}</p>
      {subDisplay != null && (
        <p className="text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap">
          {subDisplay}
        </p>
      )}
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
  languageWordCounts,
  todayReps = 0,
  todayNewCards = 0,
  todayTimeMs = 0,
  todayNewWords = 0,
  weekReps = 0,
  weekNewCards = 0,
  weekTimeMs = 0,
  weekNewWords = 0,
  monthReps = 0,
  monthNewCards = 0,
  monthTimeMs = 0,
  monthNewWords = 0,
}: NumbersRowProps) {
  const t = useTranslations('StatsPage');
  const [period, setPeriod] = useState<StatsPeriod>('week');

  const accuracy = accuracyCount > 0 ? `${Math.round((accuracySum / accuracyCount) * 100)}%` : null;
  const showAccuracy = accuracy !== null;

  // Select values based on chosen period
  const periodReps = period === 'day' ? todayReps : period === 'week' ? weekReps : monthReps;
  const periodNewCards = period === 'day' ? todayNewCards : period === 'week' ? weekNewCards : monthNewCards;
  const periodTimeMs = period === 'day' ? todayTimeMs : period === 'week' ? weekTimeMs : monthTimeMs;
  const periodNewWords = period === 'day' ? todayNewWords : period === 'week' ? weekNewWords : monthNewWords;

  // --- Snapshot-based delta animation ---
  // Track all period values so each period has its own cached "from" state.
  const { prev, changed } = useStatsSnapshot('statsPage_periods', {
    dayReps: todayReps, dayNewCards: todayNewCards, dayTimeMs: todayTimeMs, dayNewWords: todayNewWords,
    weekReps, weekNewCards, weekTimeMs, weekNewWords,
    monthReps, monthNewCards, monthTimeMs, monthNewWords,
  });

  // Only animate on initial mount, not on period switches.
  const [hasMountAnimated, setHasMountAnimated] = useState(false);
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => setHasMountAnimated(true), 2500);
    return () => clearTimeout(timer);
  }, [changed]);

  const prevReps = prev[`${period}Reps`];
  const prevNewCards = prev[`${period}NewCards`];
  const prevTimeMs = prev[`${period}TimeMs`];
  const prevNewWords = prev[`${period}NewWords`];

  const shouldAnimate = !hasMountAnimated && periodReps > 0;

  const animReps = useAnimatedCounter(periodReps, shouldAnimate ? prevReps : periodReps, 1500, 300, shouldAnimate && periodReps !== prevReps);
  const animNew = useAnimatedCounter(periodNewCards, shouldAnimate ? prevNewCards : periodNewCards, 1500, 450, shouldAnimate && periodNewCards !== prevNewCards);
  const animTime = useAnimatedCounter(periodTimeMs, shouldAnimate ? prevTimeMs : periodTimeMs, 1500, 600, shouldAnimate && periodTimeMs !== prevTimeMs);
  const animWords = useAnimatedCounter(periodNewWords, shouldAnimate ? prevNewWords : periodNewWords, 1500, 250, shouldAnimate && periodNewWords !== prevNewWords);

  const streakColor = hasLearnedToday
    ? 'var(--streak-active)'
    : streak > 0
      ? 'var(--accent-orange)'
      : undefined;

  const repsDisplay = periodReps > 0 ? `${animReps}` : null;
  const newDisplay = periodNewCards > 0 ? `+${animNew}` : null;
  const timeDisplay = periodTimeMs > 0 ? formatTimeMs(animTime) : null;
  const wordsDisplay = periodNewWords > 0 ? `+${animWords}` : null;

  return (
    <div className="card-surface p-3">
      <div className="flex items-center justify-end mb-2">
        <div className="flex gap-2 text-xs">
          {STATS_PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'transition-colors',
                period === p ? 'text-primary font-medium' : 'text-muted-foreground',
              )}
            >
              {t(p)}
            </button>
          ))}
        </div>
      </div>
      {/* Top row: always 3 items */}
      <div className="grid grid-cols-3 gap-x-4">
        <div className="flex flex-col items-center text-center gap-0.5" data-testid="stats-tile-streak">
          <Flame className="h-3.5 w-3.5" style={{ color: streakColor ?? 'var(--muted-foreground)' }} />
          <p className="text-lg font-semibold tabular-nums leading-tight" style={{ color: streakColor }}>
            {streak}
          </p>
          <p className="text-muted-xs leading-none">{t('streak')}</p>
        </div>
        <WordsCell languageWordCounts={languageWordCounts} totalWords={words} t={t} subDisplay={wordsDisplay} />
        <StatCell
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label={t('reviews')}
          value={reviews.toLocaleString()}
          subDisplay={repsDisplay}
          testId="stats-tile-reviews"
        />
      </div>

      {/* Bottom row: 3 items if accuracy available, 2 centered items (W-shape) if not */}
      {showAccuracy ? (
        <div className="grid grid-cols-3 gap-x-4 mt-3">
          <StatCell
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label={t('sentences')}
            value={sentences.toLocaleString()}
            subDisplay={newDisplay}
            testId="stats-tile-sentences"
          />
          <StatCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label={t('time')}
            value={formatTimeMs(timeMs)}
            subDisplay={timeDisplay}
            testId="stats-tile-time"
          />
          <StatCell
            icon={<Target className="h-3.5 w-3.5" />}
            label={t('accuracy')}
            value={accuracy}
            testId="stats-tile-accuracy"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 mt-3 mx-auto max-w-[66%]">
          <StatCell
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label={t('sentences')}
            value={sentences.toLocaleString()}
            subDisplay={newDisplay}
            testId="stats-tile-sentences"
          />
          <StatCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label={t('time')}
            value={formatTimeMs(timeMs)}
            subDisplay={timeDisplay}
            testId="stats-tile-time"
          />
        </div>
      )}
    </div>
  );
}

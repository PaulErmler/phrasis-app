'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion, AnimatePresence } from 'motion/react';
import { Flame, BookOpen, RotateCcw, MessageSquare, Clock, Target } from 'lucide-react';
import { formatTimeMs } from '@/lib/formatTime';
import { getLanguageByCode } from '@/lib/languages';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';

const useBrowserLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface LanguageWordCount {
  language: string;
  words: number;
}

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
}

type TodaySnapshot = { date: string; reps: number; newCards: number; timeMs: number; newWords: number };
const TODAY_SNAPSHOT_KEY = 'statsPage_todaySnapshot';

function StatCell({
  icon,
  label,
  value,
  todayDisplay,
  animateToday,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  todayDisplay?: string | null;
  animateToday?: boolean;
}) {
  const todayClassName =
    'text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap';

  return (
    <div className="flex flex-col items-center text-center gap-0.5">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
      <p className="text-muted-xs leading-none">{label}</p>

      {animateToday ? (
        <AnimatePresence initial={false}>
          {todayDisplay != null && (
            <motion.p
              initial={{ opacity: 0, height: 0, y: 4 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: 4 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={todayClassName}
            >
              {todayDisplay}
            </motion.p>
          )}
        </AnimatePresence>
      ) : (
        todayDisplay != null && (
          <p className={todayClassName}>{todayDisplay}</p>
        )
      )}
    </div>
  );
}

function getLanguageFlag(code: string): string {
  const lang = getLanguageByCode(code);
  return lang?.flag ?? '🌐';
}

function WordsCell({ languageWordCounts, totalWords, t, todayDisplay, animateToday }: {
  languageWordCounts: LanguageWordCount[];
  totalWords: number;
  t: ReturnType<typeof useTranslations>;
  todayDisplay?: string | null;
  animateToday?: boolean;
}) {
  const showFlags = languageWordCounts.length >= 2;

  if (!showFlags) {
    return (
      <StatCell
        icon={<BookOpen className="h-3.5 w-3.5" />}
        label={t('words')}
        value={totalWords.toLocaleString()}
        todayDisplay={todayDisplay}
        animateToday={animateToday}
      />
    );
  }

  const todayClassName =
    'text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap';

  return (
    <div className="flex flex-col items-center text-center gap-0.5">
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
      {animateToday ? (
        <AnimatePresence initial={false}>
          {todayDisplay != null && (
            <motion.p
              initial={{ opacity: 0, height: 0, y: 4 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: 4 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={todayClassName}
            >
              {todayDisplay}
            </motion.p>
          )}
        </AnimatePresence>
      ) : (
        todayDisplay != null && (
          <p className={todayClassName}>{todayDisplay}</p>
        )
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
}: NumbersRowProps) {
  const t = useTranslations('StatsPage');

  const accuracy = accuracyCount > 0 ? `${Math.round(accuracySum / accuracyCount)}%` : null;
  const showAccuracy = accuracy !== null;

  // --- Today snapshot animation (same pattern as ProgressStatsCard) ---
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).format(new Date());

  const prevTodaySnapshot = useRef<TodaySnapshot | null>(null);

  useBrowserLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(TODAY_SNAPSHOT_KEY);
      if (stored) {
        const parsed: TodaySnapshot = JSON.parse(stored);
        if (parsed.date === today) {
          prevTodaySnapshot.current = parsed;
          return;
        }
      }
    } catch {
      // ignore
    }
    prevTodaySnapshot.current = { date: today, reps: 0, newCards: 0, timeMs: 0, newWords: 0 };
  }, [today]);

  useEffect(() => {
    if (todayReps === 0 && todayNewCards === 0 && todayTimeMs === 0 && todayNewWords === 0) return;
    try {
      const snapshot: TodaySnapshot = { date: today, reps: todayReps, newCards: todayNewCards, timeMs: todayTimeMs, newWords: todayNewWords };
      localStorage.setItem(TODAY_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }, [todayReps, todayNewCards, todayTimeMs, todayNewWords, today]);

  const todayChanged = prevTodaySnapshot.current != null && (
    prevTodaySnapshot.current.reps !== todayReps ||
    prevTodaySnapshot.current.newCards !== todayNewCards ||
    prevTodaySnapshot.current.timeMs !== todayTimeMs ||
    prevTodaySnapshot.current.newWords !== todayNewWords
  );

  const [, setTodaySettledEpoch] = useState(0);

  useEffect(() => {
    if (!todayChanged) return;
    const timer = setTimeout(() => {
      prevTodaySnapshot.current = { date: today, reps: todayReps, newCards: todayNewCards, timeMs: todayTimeMs, newWords: todayNewWords };
      setTodaySettledEpoch((e) => e + 1);
    }, 2400);
    return () => clearTimeout(timer);
  }, [todayChanged, todayReps, todayNewCards, todayTimeMs, todayNewWords, today]);

  const prevTodayReps = prevTodaySnapshot.current?.reps ?? 0;
  const prevTodayNew = prevTodaySnapshot.current?.newCards ?? 0;
  const prevTodayTime = prevTodaySnapshot.current?.timeMs ?? 0;
  const prevTodayWords = prevTodaySnapshot.current?.newWords ?? 0;

  const animatedTodayReps = useAnimatedCounter(todayReps, prevTodayReps, 1500, 300, todayChanged);
  const animatedTodayNew = useAnimatedCounter(todayNewCards, prevTodayNew, 1500, 450, todayChanged);
  const animatedTodayTime = useAnimatedCounter(todayTimeMs, prevTodayTime, 1500, 600, todayChanged);
  const animatedTodayWords = useAnimatedCounter(todayNewWords, prevTodayWords, 1500, 250, todayChanged);

  const tApp = useTranslations('AppPage');
  const todayLabel = tApp('stats.today');
  const newLabel = tApp('stats.new');

  const streakColor = hasLearnedToday
    ? 'var(--streak-active)'
    : streak > 0
      ? 'var(--accent-orange)'
      : undefined;

  const todayRepsDisplay = todayReps > 0 ? `${animatedTodayReps} ${todayLabel}` : null;
  const todayNewDisplay = todayNewCards > 0 ? `+${animatedTodayNew} ${newLabel}` : null;
  const todayTimeDisplay = todayTimeMs > 0 ? `${formatTimeMs(animatedTodayTime)} ${todayLabel}` : null;
  const todayWordsDisplay = todayNewWords > 0 ? `+${animatedTodayWords} ${todayLabel}` : null;

  return (
    <div className="card-surface p-3">
      {/* Top row: always 3 items */}
      <div className="grid grid-cols-3 gap-x-4">
        <div className="flex flex-col items-center text-center gap-0.5">
          <Flame className="h-3.5 w-3.5" style={{ color: streakColor ?? 'var(--muted-foreground)' }} />
          <p className="text-lg font-semibold tabular-nums leading-tight" style={{ color: streakColor }}>
            {streak}
          </p>
          <p className="text-muted-xs leading-none">{t('streak')}</p>
        </div>
        <WordsCell languageWordCounts={languageWordCounts} totalWords={words} t={t} todayDisplay={todayWordsDisplay} animateToday={todayChanged} />
        <StatCell
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          label={t('reviews')}
          value={reviews.toLocaleString()}
          todayDisplay={todayRepsDisplay}
          animateToday={todayChanged}
        />
      </div>

      {/* Bottom row: 3 items if accuracy available, 2 centered items (W-shape) if not */}
      {showAccuracy ? (
        <div className="grid grid-cols-3 gap-x-4 mt-3">
          <StatCell
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label={t('sentences')}
            value={sentences.toLocaleString()}
            todayDisplay={todayNewDisplay}
            animateToday={todayChanged}
          />
          <StatCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label={t('time')}
            value={formatTimeMs(timeMs)}
            todayDisplay={todayTimeDisplay}
            animateToday={todayChanged}
          />
          <StatCell
            icon={<Target className="h-3.5 w-3.5" />}
            label={t('accuracy')}
            value={accuracy}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 mt-3 mx-auto max-w-[66%]">
          <StatCell
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label={t('sentences')}
            value={sentences.toLocaleString()}
            todayDisplay={todayNewDisplay}
            animateToday={todayChanged}
          />
          <StatCell
            icon={<Clock className="h-3.5 w-3.5" />}
            label={t('time')}
            value={formatTimeMs(timeMs)}
            todayDisplay={todayTimeDisplay}
            animateToday={todayChanged}
          />
        </div>
      )}
    </div>
  );
}

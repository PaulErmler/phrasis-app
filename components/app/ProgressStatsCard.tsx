'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { motion, AnimatePresence } from 'motion/react';
import { Flame, RotateCcw, MessageSquare, Clock, Snowflake } from 'lucide-react';
import { formatTimeMs } from '@/lib/formatTime';
import { StartLearningButton } from '@/components/app/StartLearningButton';
import type { ReviewMode } from '@/convex/types';

function useAnimatedCounter(target: number, durationMs = 800, delay = 0): number {
  const [value, setValue] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) {
      setValue(0);
      return;
    }

    const timeout = setTimeout(() => {
      startTimeRef.current = null;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) startTimeRef.current = timestamp;
        const elapsed = timestamp - startTimeRef.current;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));

        if (progress < 1) {
          rafRef.current = requestAnimationFrame(animate);
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, delay]);

  return value;
}

function StatColumn({
  icon,
  label,
  value,
  todayValue,
  todayPrefix,
  todayLabel = 'today',
  todayFormatter,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  todayValue?: number;
  todayPrefix?: string;
  todayLabel?: string;
  todayFormatter?: (v: number) => string;
}) {
  const displayValue =
    todayValue != null && todayValue > 0
      ? todayFormatter
        ? todayFormatter(todayValue)
        : String(todayValue)
      : null;

  return (
    <div className="flex flex-col items-center text-center gap-1">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight whitespace-nowrap">
        {value}
      </p>
      <p className="text-muted-xs leading-none">{label}</p>

      <AnimatePresence initial={false}>
        {displayValue != null && (
          <motion.p
            initial={{ opacity: 0, height: 0, y: 4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: 4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap"
          >
            {todayPrefix}{displayValue} {todayLabel}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ProgressStatsCard({
  onStartReview,
  animateEntrance,
}: {
  onStartReview: (mode: ReviewMode) => void;
  animateEntrance?: boolean;
}) {
  const t = useTranslations('AppPage');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const stats = useCachedQuery(api.features.courses.getCourseStats, { timezone }, 'courseStats');
  const todayStats = useCachedQuery(api.features.courses.getTodayStats, { timezone }, 'todayStats');

  const streak = stats?.currentStreak ?? 0;
  const reps = stats?.totalRepetitions ?? 0;
  const cards = stats?.totalCards ?? 0;
  const time = formatTimeMs(stats?.totalTimeMs ?? 0);

  const hasLearned = todayStats != null && todayStats.reps > 0;
  const isFrozen = stats?.streakFrozenToday === true && !hasLearned;
  const isInactive = streak === 0 && !hasLearned && !isFrozen;

  const animatedReps = useAnimatedCounter(
    hasLearned ? todayStats.reps : 0,
    700,
    250,
  );
  const animatedNew = useAnimatedCounter(
    hasLearned ? todayStats.newCards : 0,
    700,
    350,
  );
  const animatedTimeMs = useAnimatedCounter(
    hasLearned ? todayStats.timeMs : 0,
    700,
    450,
  );

  const content = (
    <div className="card-surface p-4 space-y-4" data-tutorial="progress-stats">
      <div className="flex items-end gap-4">
        {/* Streak badge */}
        <div className="flex flex-col items-center gap-0.5">
          <motion.div
            className="flex items-center justify-center h-10 w-10 rounded-xl"
            animate={
              isInactive
                ? { backgroundColor: 'transparent', scale: 1 }
                : isFrozen
                  ? {
                      backgroundColor: 'color-mix(in oklch, var(--primary) 15%, transparent)',
                      scale: [1, 1.05, 1],
                    }
                  : hasLearned
                    ? {
                        backgroundColor: 'color-mix(in oklch, var(--streak-active) 15%, transparent)',
                        scale: [1, 1.15, 1],
                      }
                    : {
                        backgroundColor: 'color-mix(in oklch, var(--accent-orange) 10%, transparent)',
                        scale: 1,
                      }
            }
            transition={
              isInactive
                ? { duration: 0.3 }
                : isFrozen
                  ? { duration: 2, repeat: Infinity, repeatType: 'reverse' as const }
                  : hasLearned
                    ? { backgroundColor: { duration: 0.4 }, scale: { duration: 0.5, ease: 'easeOut' } }
                    : { duration: 0.3 }
            }
          >
            <AnimatePresence mode="wait" initial={false}>
              {isFrozen ? (
                <motion.div
                  key="snowflake"
                  initial={{ opacity: 0, scale: 0.5, rotate: -90 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.3, rotate: 90, filter: 'blur(4px)' }}
                  transition={{ duration: 0.4 }}
                >
                  <Snowflake className="h-5 w-5" style={{ color: 'var(--primary)' }} />
                </motion.div>
              ) : (
                <motion.div
                  key="flame"
                  initial={{ opacity: 0, scale: 0.3, rotate: 90, filter: 'blur(4px)' }}
                  animate={{
                    opacity: 1,
                    scale: hasLearned ? [0.3, 1.3, 1] : 1,
                    rotate: hasLearned ? [90, -10, 0] : 0,
                    filter: 'blur(0px)',
                  }}
                  transition={{ duration: hasLearned ? 0.7 : 0.4, ease: 'easeOut' }}
                >
                  <Flame
                    className="h-5 w-5 transition-colors duration-400"
                    style={{
                      color: hasLearned
                        ? 'var(--streak-active)'
                        : isInactive
                          ? 'var(--muted-foreground)'
                          : 'var(--accent-orange)',
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          <span
            className="text-lg font-bold tabular-nums leading-tight transition-colors duration-400"
            style={{
              color: isInactive
                ? 'var(--muted-foreground)'
                : isFrozen
                  ? 'var(--primary)'
                  : hasLearned
                    ? 'var(--streak-active)'
                    : undefined,
            }}
          >
            {streak}
          </span>
          <span className="text-muted-xs leading-none">{t('stats.streak')}</span>
        </div>

        {/* Divider */}
        <div className="w-px self-stretch bg-border" />

        {/* 3 stat columns */}
        <div className="flex-1 grid grid-cols-3 gap-2">
          <StatColumn
            icon={<RotateCcw className="h-4 w-4" />}
            label={t('stats.reps')}
            value={String(reps)}
            todayValue={hasLearned ? animatedReps : undefined}
            todayLabel={t('stats.today')}
          />
          <StatColumn
            icon={<MessageSquare className="h-4 w-4" />}
            label={t('stats.sentences')}
            value={String(cards)}
            todayValue={hasLearned && todayStats.newCards > 0 ? animatedNew : undefined}
            todayPrefix="+"
            todayLabel={t('stats.new')}
          />
          <StatColumn
            icon={<Clock className="h-4 w-4" />}
            label={t('stats.time')}
            value={time}
            todayValue={hasLearned && todayStats.timeMs > 0 ? animatedTimeMs : undefined}
            todayFormatter={formatTimeMs}
            todayLabel={t('stats.today')}
          />
        </div>
      </div>
      <StartLearningButton onStartReview={onStartReview} />
    </div>
  );

  if (animateEntrance) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        {content}
      </motion.div>
    );
  }

  return content;
}

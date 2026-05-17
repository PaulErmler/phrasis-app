'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useCachedQuery } from '@/hooks/use-cached-query';
import { useAnimatedCounter } from '@/hooks/use-animated-counter';
import { useStatsSnapshot } from '@/hooks/use-stats-snapshot';
import { motion, AnimatePresence } from 'motion/react';
import {
  Flame,
  RotateCcw,
  MessageSquare,
  Clock,
  Snowflake,
  BookOpen,
} from 'lucide-react';
import { formatTimeMs } from '@/lib/formatTime';
import { StartLearningButton } from '@/components/app/StartLearningButton';
import { CEFR_COLORS, isCefr } from '@/components/app/segmented/cefr';
import { getLanguageByCode } from '@/lib/languages';
import { cn } from '@/lib/utils';
import type { ReviewMode, SchedulingMode } from '@/convex/types';

function StatColumn({
  icon,
  label,
  value,
  todayValue,
  todayPrefix,
  todayLabel = 'today',
  todayFormatter,
  animateToday = true,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  todayValue?: number;
  todayPrefix?: string;
  todayLabel?: string;
  todayFormatter?: (v: number) => string;
  animateToday?: boolean;
  /** Extra classes for the column wrapper — used by the home view to hide
   * the words stat on narrow screens (`hidden sm:flex`). */
  className?: string;
}) {
  const displayValue =
    todayValue != null && todayValue > 0
      ? todayFormatter
        ? todayFormatter(todayValue)
        : String(todayValue)
      : null;

  const todayClassName =
    'text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap';

  return (
    <div
      className={cn(
        'flex flex-col items-center text-center gap-1',
        className,
      )}
    >
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight whitespace-nowrap">
        {value}
      </p>
      <p className="text-muted-xs leading-none">{label}</p>

      {animateToday ? (
        <AnimatePresence initial={false}>
          {displayValue != null && (
            <motion.p
              initial={{ opacity: 0, height: 0, y: 4 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: 4 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={todayClassName}
            >
              {todayPrefix}{displayValue} {todayLabel}
            </motion.p>
          )}
        </AnimatePresence>
      ) : (
        displayValue != null && (
          <p className={todayClassName}>
            {todayPrefix}{displayValue} {todayLabel}
          </p>
        )
      )}
    </div>
  );
}

export function ProgressStatsCard({
  onStartLearn,
  reviewMode,
  onReviewModeChange,
  animateEntrance,
  skipLiveStats,
  courseId,
  hasPlayableCards,
}: {
  onStartLearn: (schedulingMode: SchedulingMode) => void;
  reviewMode: ReviewMode;
  onReviewModeChange: (mode: ReviewMode) => void;
  animateEntrance?: boolean;
  skipLiveStats?: boolean;
  courseId?: string;
  hasPlayableCards?: boolean;
}) {
  const t = useTranslations('AppPage');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const queryArgs = skipLiveStats ? ('skip' as const) : { timezone };
  const cacheSuffix = courseId ? `_${courseId}` : '';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  const stats = useCachedQuery(api.features.courses.getCourseStats, queryArgs, `courseStats${cacheSuffix}`);
  const todayStats = useCachedQuery(api.features.courses.getTodayStats, queryArgs, `todayStats_${today}${cacheSuffix}`);

  const snapshotKey = courseId ? `todayStats_snapshot_${courseId}` : 'todayStats_snapshot';

  const { prev, changed: statsActuallyChanged } = useStatsSnapshot(
    snapshotKey,
    { reps: todayStats?.reps ?? 0, newCards: todayStats?.newCards ?? 0, timeMs: todayStats?.timeMs ?? 0 },
    { dateScoped: true },
  );

  const streak = stats?.currentStreak ?? 0;
  const reps = stats?.totalRepetitions ?? 0;
  const cards = stats?.totalCards ?? 0;
  const words = stats?.totalWordCount ?? 0;
  const time = formatTimeMs(stats?.totalTimeMs ?? 0);

  // Home summary powers the "current level" header strip — Convex dedupes
  // this subscription with SegmentedHomeSection so no extra round-trip.
  const homeSummary = useQuery(
    api.features.home.getHomeSummary,
    skipLiveStats ? 'skip' : {},
  );

  // Only render the level header when a *premade* CEFR level is active.
  // Custom and chat collections live in `customCollections` and don't carry
  // a tier/code we can label here.
  const activeLevel =
    homeSummary?.levels.find(
      (l) => l.collectionId === homeSummary.activeCollectionId,
    ) ?? null;

  // Compose the level label: "Spanish · French A1.2" when the course has
  // multiple target languages, "Spanish A1.2" for a single language. Falls
  // back to the raw level code if none of the codes resolve to a Language
  // (e.g. during loading or in misconfigured tests).
  const targetLanguageNames =
    stats?.targetLanguages
      .map((code) => getLanguageByCode(code)?.name)
      .filter((n): n is string => !!n) ?? [];
  const levelLabel = activeLevel
    ? targetLanguageNames.length > 0
      ? `${targetLanguageNames.join(' · ')} ${activeLevel.code}`
      : activeLevel.code
    : null;

  // Progress within the active premade level.
  const levelPct =
    activeLevel && activeLevel.totalTexts > 0
      ? Math.min(1, activeLevel.cardsAdded / activeLevel.totalTexts)
      : 0;
  const levelPctLabel = `${Math.round(levelPct * 100)}%`;
  const levelTier =
    activeLevel && isCefr(activeLevel.cefrTier) ? activeLevel.cefrTier : null;
  const levelTierColor = levelTier ? CEFR_COLORS[levelTier] : null;

  const hasLearned = todayStats != null && todayStats.reps > 0;
  const isFrozen = stats?.streakFrozenToday === true && !hasLearned;
  const isInactive = streak === 0 && !hasLearned && !isFrozen;

  const animatedReps = useAnimatedCounter(
    hasLearned ? todayStats.reps : 0,
    prev.reps,
    1500,
    300,
    statsActuallyChanged,
  );
  const animatedNew = useAnimatedCounter(
    hasLearned ? todayStats.newCards : 0,
    prev.newCards,
    1500,
    450,
    statsActuallyChanged,
  );
  const animatedTimeMs = useAnimatedCounter(
    hasLearned ? todayStats.timeMs : 0,
    prev.timeMs,
    1500,
    600,
    statsActuallyChanged,
  );

  const content = (
    <div className="space-y-2">
      <div
        className="card-surface overflow-hidden"
        data-tutorial="progress-stats"
      >
        {/* Top progress bar — pinned to the card's top edge, tinted with the
         * active CEFR tier color. Renders even when level info hasn't loaded
         * yet (width: 0) so the card height stays stable. */}
        <div className="h-1 bg-muted">
          {activeLevel && levelTierColor && (
            <div
              className="h-full transition-all"
              style={{
                width: `${levelPct * 100}%`,
                backgroundColor: levelTierColor,
              }}
            />
          )}
        </div>

        <div className="space-y-3 p-4">
          {/* Level header row — inline CEFR badge + label + count + % pill.
           * Hidden when the active collection is custom/chat. */}
          {activeLevel && (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-primary">
                    {activeLevel.cefrTier}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {levelLabel}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    · {activeLevel.cardsAdded} / {activeLevel.totalTexts}
                  </span>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary">
                  {levelPctLabel}
                </span>
              </div>
              <div className="-mx-4 border-t" />
            </>
          )}

          <div className="flex items-end gap-4">
            {/* Streak badge */}
            <div className="flex flex-col items-center gap-0.5">
              <motion.div
                className={cn(
                  'flex items-center justify-center h-10 w-10 rounded-xl transition-colors duration-400 ease-out',
                  isInactive && 'bg-transparent',
                  isFrozen && 'bg-primary/15',
                  hasLearned && 'bg-streak-active/15',
                  !isInactive && !isFrozen && !hasLearned && 'bg-accent-orange/10',
                )}
                animate={
                  isInactive
                    ? { scale: 1 }
                    : isFrozen
                      ? { scale: [1, 1.05, 1] }
                      : hasLearned
                        ? { scale: statsActuallyChanged ? [1, 1.15, 1] : 1 }
                        : { scale: 1 }
                }
                transition={
                  isInactive
                    ? { duration: 0.3 }
                    : isFrozen
                      ? { duration: 2, repeat: Infinity, repeatType: 'reverse' as const }
                      : hasLearned
                        ? { duration: 1, ease: 'easeOut' }
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
                        scale: hasLearned && statsActuallyChanged ? [0.3, 1.3, 1] : 1,
                        rotate: hasLearned && statsActuallyChanged ? [90, -10, 0] : 0,
                        filter: 'blur(0px)',
                      }}
                      transition={{ duration: hasLearned && statsActuallyChanged ? 1.4 : 0.4, ease: 'easeOut' }}
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

            {/* Stats grid — 3 columns on mobile, 4 on sm+ where words fits. */}
            <div className="flex-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
              <StatColumn
                icon={<RotateCcw className="h-4 w-4" />}
                label={t('stats.reps')}
                value={String(reps)}
                todayValue={hasLearned ? animatedReps : undefined}
                todayLabel={t('stats.today')}
                animateToday={statsActuallyChanged}
              />
              <StatColumn
                icon={<MessageSquare className="h-4 w-4" />}
                label={t('stats.sentences')}
                value={String(cards)}
                todayValue={hasLearned && todayStats.newCards > 0 ? animatedNew : undefined}
                todayPrefix="+"
                todayLabel={t('stats.new')}
                animateToday={statsActuallyChanged}
              />
              <StatColumn
                icon={<BookOpen className="h-4 w-4" />}
                label={t('stats.words')}
                value={String(words)}
                className="hidden sm:flex"
              />
              <StatColumn
                icon={<Clock className="h-4 w-4" />}
                label={t('stats.time')}
                value={time}
                todayValue={hasLearned && todayStats.timeMs > 0 ? animatedTimeMs : undefined}
                todayFormatter={formatTimeMs}
                todayLabel={t('stats.today')}
                animateToday={statsActuallyChanged}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="card-surface p-3">
        <StartLearningButton
          onStartLearn={onStartLearn}
          reviewMode={reviewMode}
          onReviewModeChange={onReviewModeChange}
          hasPlayableCards={hasPlayableCards}
        />
      </div>
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

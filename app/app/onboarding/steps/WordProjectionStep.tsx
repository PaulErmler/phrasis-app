'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { BookOpen, TrendingUp, Sparkles } from 'lucide-react';
import { getUserTimezone } from '@/lib/timezone';
import { DAILY_TIME_CUSTOM_MIN, DAILY_TIME_CUSTOM_MAX } from '../types';
import type { OnboardingSessionSummary } from '../components/OnboardingFirstLesson';

// Long-horizon vocab projections are noisy and unrealistic past a certain
// point — cap each milestone at a believable ceiling so the screen doesn't
// promise "you'll know 73,412 words in a year" off a 3-minute sample.
const PROJECTION_CAP_WORDS = 10_000;

/**
 * Step 11 — "at this pace, here's where you'll be" projection over
 * 1 month / 6 months / 1 year. Mirrors the milestone card layout from the
 * stats-recap prototype but renders only the projection (the celebration
 * counter + word list are already shown by the previous step).
 */
interface Props {
  summary: OnboardingSessionSummary | null;
  dailyTimeGoalMinutes: number;
  /** Persist a new daily-goal value back to the wizard. The slider on this
   *  page lets the user retune their goal after seeing the projection. */
  onDailyTimeChange?: (minutes: number) => void;
  onContinue: () => void;
}

const MILESTONES = [
  { key: '1mo' as const, days: 30, Icon: BookOpen },
  { key: '6mo' as const, days: 180, Icon: TrendingUp },
  { key: '1y' as const, days: 365, Icon: Sparkles },
] as const;

// Linear projection with a flat 1/7 dampener — the user's first-session
// pace is unrealistically fast (most cards are new and the user is fresh
// + warm-up reviews count toward early counts), so projecting at the raw
// words/minute rate massively inflates long-horizon numbers.
function project(
  newWords: number,
  sessionMinutes: number,
  dailyTimeGoalMinutes: number,
  days: number,
): number {
  if (sessionMinutes <= 0) return 0;
  const wordsPerMin = newWords / sessionMinutes;
  const linear = wordsPerMin * dailyTimeGoalMinutes * days;
  return Math.min(PROJECTION_CAP_WORDS, Math.round(linear / 7));
}

export function WordProjectionStep({
  summary,
  dailyTimeGoalMinutes,
  onDailyTimeChange,
  onContinue,
}: Props) {
  const t = useTranslations('Onboarding.wordProjection');
  // Snapshot's `dailyTimeMsToday` is captured BEFORE the last card's review
  // mutation lands (auto-advance fires `onCardRated` synchronously while
  // the mutation is in flight), so it consistently undercounts by one
  // card. Pull the post-commit value via `getTodayStats` instead; fall
  // back to the snapshot until the query resolves.
  //
  // The same problem affects the new-words count when the user reaches
  // this screen via the skip path on an abort/restart cycle: `summary`
  // is null (skip wipes it), so falling back to `summary?.dailyNewWords`
  // would always show 0 even though today's actual count is positive.
  // Pull words live from `getNewWordsForCelebration`, summing BOTH
  // buckets — the query splits today's unique words into `session`
  // (current session id) and `today` (other sessions). They're disjoint,
  // so the total is `session.length + today.length`. Using only one
  // bucket undercounts the projection — e.g. abort + restart + rate one
  // more card would put 5 prior-session words in `today` and 1 in
  // `session`, so `today.length` alone reports 5 / `session.length`
  // alone reports 1 instead of the correct total of 6.
  const timezone = useMemo(() => getUserTimezone(), []);
  const todayStats = useQuery(api.features.courses.getTodayStats, { timezone });
  const celebrationWords = useQuery(api.features.stats.getNewWordsForCelebration, {
    sessionId: summary?.sessionId ?? 'onboarding-skip',
    timezone,
  });
  const newWords = celebrationWords
    ? celebrationWords.session.length + celebrationWords.today.length
    : (summary?.dailyNewWordsToday ?? 0);
  const liveTimeMs = todayStats?.timeMs ?? summary?.dailyTimeMsToday ?? 0;
  const sessionMinutes = liveTimeMs > 0
    ? Math.max(1, liveTimeMs / 60_000)
    : 3;
  const minutes = Math.round(sessionMinutes);
  // Local mirror so the slider feels instant; the wizard's persist call
  // happens on every drag step, which also updates `dailyTimeGoalMinutes`
  // via re-render — keep them in sync.
  const [localGoal, setLocalGoal] = useState(dailyTimeGoalMinutes);
  // Reconcile if the prop changes externally (e.g. after persist commits).
  if (localGoal !== dailyTimeGoalMinutes && !onDailyTimeChange) {
    setLocalGoal(dailyTimeGoalMinutes);
  }
  const activeGoal = onDailyTimeChange ? localGoal : dailyTimeGoalMinutes;
  const handleGoalChange = (next: number) => {
    setLocalGoal(next);
    onDailyTimeChange?.(next);
  };

  return (
    <div
      data-testid="onboarding-step-word-projection"
      className="flex flex-col h-full overflow-hidden animate-in fade-in duration-300"
    >
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto w-full space-y-6">
          <div className="text-center pt-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('summary', { words: newWords, minutes })}
            </p>
            <h2 className="text-2xl font-bold">{t('headline')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('perDay', { minutes: activeGoal })}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {MILESTONES.map(({ key, days, Icon }) => {
              const projected = project(newWords, sessionMinutes, activeGoal, days);
              const capped = projected >= PROJECTION_CAP_WORDS;
              return (
                <div key={key} className="card-surface p-3 md:p-4 text-center space-y-1">
                  <Icon className="h-4 w-4 md:h-5 md:w-5 mx-auto" style={{ color: 'var(--primary)' }} />
                  <div className="text-muted-xs">{t(`milestones.${key}`)}</div>
                  <div className="text-xl md:text-2xl font-bold tabular-nums">
                    {projected.toLocaleString()}{capped ? '+' : ''}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{t('wordsUnit')}</div>
                </div>
              );
            })}
          </div>

          {onDailyTimeChange ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('adjustLabel')}</span>
                <span className="font-semibold tabular-nums">
                  {t('perDay', { minutes: activeGoal })}
                </span>
              </div>
              <Slider
                value={[activeGoal]}
                min={DAILY_TIME_CUSTOM_MIN}
                max={DAILY_TIME_CUSTOM_MAX}
                step={1}
                onValueChange={(v) => handleGoalChange(v[0])}
                aria-label={t('adjustLabel')}
              />
            </div>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 border-t bg-background py-3 px-4">
        <Button
          size="lg"
          className="w-full max-w-md mx-auto block"
          onClick={onContinue}
          data-testid="word-projection-continue"
        >
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}

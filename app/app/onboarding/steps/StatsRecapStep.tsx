'use client';

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ProgressDisplay } from '@/components/app/learning/ProgressDisplay';
import { getUserTimezone } from '@/lib/timezone';
import type { OnboardingSessionSummary } from '../components/OnboardingFirstLesson';

/**
 * Step 10 — celebration after the first lesson.
 *
 * Reuses the in-session `ProgressDisplay` for the visuals (hero count,
 * audio sting, stat cells, word ticker). Daily counters are fetched fresh
 * via `getTodayStats` rather than relying on the `onCardRated` snapshot
 * which is always one card behind the post-rating server state — the
 * mismatch between hero ("+15 new words") and the "+13 new words today"
 * cell was caused by reading stale snapshot values.
 */
interface Props {
  summary: OnboardingSessionSummary | null;
  reviewMode: 'audio' | 'full';
  onContinue: () => void;
}

export function StatsRecapStep({ summary, reviewMode, onContinue }: Props) {
  const timezone = useMemo(() => getUserTimezone(), []);
  const todayStats = useQuery(api.features.courses.getTodayStats, { timezone });
  const sessionId = summary?.sessionId ?? 'onboarding-skip';

  // `getTodayStats` covers reps + timeMs straight from `dailyStats`. For the
  // new-words count, query `getNewWordsForCelebration` and read both buckets:
  //   - `session`: words seen in this onboarding session (drives the hero).
  //   - `today`: words seen earlier today but NOT in this session.
  // The "+N new words today" cell is the *total* for today, so we add the
  // two buckets together — using only `today.length` undercounts and was
  // the cause of the hero/cell mismatch.
  const celebrationWords = useQuery(
    api.features.stats.getNewWordsForCelebration,
    { sessionId, timezone },
  );

  // Prefer the fresh server values when they've loaded; fall back to the
  // snapshot so the screen still renders something while the query is in
  // flight. Skip-lesson path passes summary === null and degrades to zeros.
  const dailyReviewsToday = todayStats?.reps ?? summary?.dailyReviewsToday ?? 0;
  const dailyTimeMsToday = todayStats?.timeMs ?? summary?.dailyTimeMsToday ?? 0;
  const dailyNewWordsToday = celebrationWords
    ? celebrationWords.session.length + celebrationWords.today.length
    : (summary?.dailyNewWordsToday ?? 0);

  return (
    <div data-testid="onboarding-step-stats-recap" className="h-full">
      <ProgressDisplay
        sessionId={sessionId}
        dailyReviewsToday={dailyReviewsToday}
        dailyTimeMsToday={dailyTimeMsToday}
        dailyNewWordsToday={dailyNewWordsToday}
        schedulingMode="learnAndReview"
        reviewMode={reviewMode}
        autoAdvance={false}
        onContinue={onContinue}
        ready
      />
    </div>
  );
}

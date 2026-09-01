import { MutationCtx } from '../../_generated/server';
import { Id } from '../../_generated/dataModel';
import { ConvexError } from 'convex/values';
import {
  getCourseStatsForMutation,
  getTodayInTimezone,
  computeStreakUpdate,
} from '../courseStats';
import { upsertDailyStats } from './dailyStats';
import { upsertWeeklyStats, getISOWeekString } from './weeklyStats';
import { upsertMonthlyStats, getMonthString } from './monthlyStats';
import { upsertYearlyStats, getYearString } from './yearlyStats';
import type { StatsReviewMode } from '../../types';

const MAX_TIME_PER_PLAY_MS = 180_000; // 3 minutes — same cap as reviews

/**
 * Lightweight stats recorder for a free-play card advance (radio play or
 * free-study pass).
 *
 * Free play bypasses FSRS, ratings, accuracy, and word tracking, so the
 * heavy `recordReviewStats` would do far too much work and (worse) inflate
 * counters that should only reflect active learning. This helper updates only:
 *
 *   - `courseStats.totalRepetitions`, `totalTimeMs`, `totalTimeMsByMode.<mode>`,
 *     `totalReviewsByMode.<mode>`, plus the streak (free play counts as
 *     activity)
 *   - `dailyStats` reps/timeMs/reviewsByMode.<mode>/timeMsByMode.<mode>
 *   - weekly / monthly / yearly aggregates with `reviewMode: <mode>`
 *
 * Explicitly skipped (NOT tracked for free plays):
 *   - word tracking (`userWords`, `userWordTexts`, `dailyLanguageStats`,
 *     `languageStats`): free play is practice outside the schedule, not
 *     graded vocabulary acquisition
 *   - rating / accuracy / hour buckets / reviewsByCardState: no FSRS rating
 *   - collection progress (`cardsLearned`): only active reviews graduate cards
 */
export async function recordFreePlayStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    timezone: string;
    timeSpentMs?: number;
    mode: Extract<StatsReviewMode, 'radio' | 'freeStudy'>;
  },
): Promise<void> {
  const nonNegativeTime = Math.max(args.timeSpentMs ?? 0, 0);
  const clampedTime = Math.min(nonNegativeTime, MAX_TIME_PER_PLAY_MS);

  const stats = await getCourseStatsForMutation(
    ctx,
    args.userId,
    args.courseId,
  );
  if (!stats) {
    throw new ConvexError({
      code: 'NOT_FOUND',
      message: 'Course stats not found',
    });
  }

  const todayDate = getTodayInTimezone(args.timezone);
  const { newStreak, newLastActivityDate, newFreezeCount, newFreezeUsedDate } =
    computeStreakUpdate(
      stats.lastActivityDate,
      todayDate,
      stats.currentStreak,
      stats.streakFreezeCount,
      stats.streakFreezeUsedDate,
    );

  // --- Course-level counters ---
  const prevModeReviews: Record<StatsReviewMode, number> = {
    audio: 0,
    full: 0,
    radio: 0,
    freeStudy: 0,
    ...(stats.totalReviewsByMode ?? {}),
  };
  const prevModeTime: Record<StatsReviewMode, number> = {
    audio: 0,
    full: 0,
    radio: 0,
    freeStudy: 0,
    ...(stats.totalTimeMsByMode ?? {}),
  };
  await ctx.db.patch(stats._id, {
    totalRepetitions: stats.totalRepetitions + 1,
    totalTimeMs: stats.totalTimeMs + clampedTime,
    totalTimeMsByMode: {
      ...prevModeTime,
      [args.mode]: prevModeTime[args.mode] + clampedTime,
    },
    currentStreak: newStreak,
    lastActivityDate: newLastActivityDate,
    timezone: args.timezone,
    streakFreezeCount: newFreezeCount,
    streakFreezeUsedDate: newFreezeUsedDate,
    totalReviewsByMode: {
      ...prevModeReviews,
      [args.mode]: prevModeReviews[args.mode] + 1,
    },
  });

  // --- Daily aggregate (reps + reviewsByMode.<mode> + timeMsByMode.<mode>) ---
  // No rating/accuracy/hour/cardState. Free plays are explicitly anonymous
  // along those dimensions.
  const { isFirstActivityToday } = await upsertDailyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    date: todayDate,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: args.mode,
  });

  // --- Weekly / monthly / yearly ---
  const week = getISOWeekString(todayDate);
  const month = getMonthString(todayDate);
  const year = getYearString(todayDate);

  const { isFirstActivityThisWeek } = await upsertWeeklyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    week,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: args.mode,
    isFirstActivityToday,
  });

  const { isFirstActivityThisMonth } = await upsertMonthlyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    month,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: args.mode,
    isFirstActivityToday,
    isFirstActivityThisWeek,
  });

  await upsertYearlyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    year,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: args.mode,
    isFirstActivityToday,
    isFirstActivityThisWeek,
    isFirstActivityThisMonth,
  });
}

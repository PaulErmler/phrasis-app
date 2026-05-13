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

const MAX_TIME_PER_PLAY_MS = 180_000; // 3 minutes — same cap as reviews

/**
 * Lightweight stats recorder for a radio-mode card play.
 *
 * Radio bypasses FSRS, ratings, accuracy, and word tracking — so the heavy
 * `recordReviewStats` would do far too much work and (worse) inflate counters
 * that should only reflect active learning. This helper updates only:
 *
 *   - `courseStats.totalRepetitions`, `totalTimeMs`, `totalReviewsByMode.radio`,
 *     plus the streak (radio counts as activity)
 *   - `dailyStats` reps/timeMs/reviewsByMode.radio/timeMsByMode.radio
 *   - weekly / monthly / yearly aggregates with `reviewMode: 'radio'`
 *
 * Explicitly skipped (NOT tracked for radio plays):
 *   - word tracking (`userWords`, `userWordTexts`, `dailyLanguageStats`,
 *     `languageStats`) — radio is passive listening, not active vocabulary
 *     acquisition
 *   - rating / accuracy / hour buckets / reviewsByCardState — no FSRS rating
 *   - collection progress (`cardsLearned`) — only active reviews graduate cards
 */
export async function recordRadioPlayStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    timezone: string;
    timeSpentMs?: number;
  },
): Promise<void> {
  const nonNegativeTime = Math.max(args.timeSpentMs ?? 0, 0);
  const clampedTime = Math.min(nonNegativeTime, MAX_TIME_PER_PLAY_MS);

  const stats = await getCourseStatsForMutation(ctx, args.userId, args.courseId);
  if (!stats) {
    throw new ConvexError('Course stats not found');
  }

  const todayDate = getTodayInTimezone(args.timezone);
  const {
    newStreak,
    newLastActivityDate,
    newFreezeCount,
    newFreezeUsedDate,
  } = computeStreakUpdate(
    stats.lastActivityDate,
    todayDate,
    stats.currentStreak,
    stats.streakFreezeCount,
    stats.streakFreezeUsedDate,
  );

  // --- Course-level counters ---
  const prevModeReviews: { audio: number; full: number; radio: number } = {
    audio: 0,
    full: 0,
    radio: 0,
    ...(stats.totalReviewsByMode ?? {}),
  };
  await ctx.db.patch(stats._id, {
    totalRepetitions: stats.totalRepetitions + 1,
    totalTimeMs: stats.totalTimeMs + clampedTime,
    currentStreak: newStreak,
    lastActivityDate: newLastActivityDate,
    timezone: args.timezone,
    streakFreezeCount: newFreezeCount,
    streakFreezeUsedDate: newFreezeUsedDate,
    totalReviewsByMode: { ...prevModeReviews, radio: prevModeReviews.radio + 1 },
  });

  // --- Daily aggregate (reps + reviewsByMode.radio + timeMsByMode.radio) ---
  // No rating/accuracy/hour/cardState — radio plays are explicitly anonymous
  // along those dimensions.
  const { isFirstActivityToday } = await upsertDailyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    date: todayDate,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: 'radio',
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
    reviewMode: 'radio',
    isFirstActivityToday,
  });

  const { isFirstActivityThisMonth } = await upsertMonthlyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    month,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: 'radio',
    isFirstActivityToday,
    isFirstActivityThisWeek,
  });

  await upsertYearlyStats(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    year,
    timeMs: clampedTime,
    isNewCard: false,
    reviewMode: 'radio',
    isFirstActivityToday,
    isFirstActivityThisWeek,
    isFirstActivityThisMonth,
  });
}

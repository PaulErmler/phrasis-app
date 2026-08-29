import { MutationCtx } from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';
import { getCourseStatsForMutation } from '../courseStats';
import { getDailyStats, displayedActiveReviews } from './dailyStats';
import {
  getTodayInTimezone,
  getISOWeekString,
  getMonthString,
  getYearString,
} from '../../lib/dateUtils';
import { FSRS_STATE_LABELS } from '../../lib/fsrsStates';
import type { StatsReviewMode } from '../../types';

/**
 * Mirror images of `recordReviewStats` / `recordFreePlayStats` for the
 * learn-mode undo feature. Each reversal decrements exactly the counters its
 * counterpart incremented, keyed by the values stored in the review log entry
 * (day key, hour bucket, resolved mode, languages) rather than recomputed,
 * so an undo after midnight still targets yesterday's rows.
 *
 * Deliberately NOT reversed (the review genuinely happened):
 *   - all timeMs fields (the user really spent that time learning)
 *   - streak / lastActivityDate / freeze fields / activeDays|Weeks|Months
 *   - word tracking (`userWords`, `totalWordCount`, `newWordsCount`): the
 *     card keeps its `wordsTrackedLanguages` stamp so a re-review can't
 *     double-track either
 *   - `dailyStats.lastCelebratedAtCount`: keeps a re-review from replaying
 *     an already-shown celebration
 *
 * All decrements clamp at 0 and tolerate missing rows/fields (a stats row can
 * predate an optional field, or theoretically have been swept).
 */

/**
 * Manifest of the stat fields a card review may change that undo
 * DELIBERATELY leaves in place (see the module doc above for why), keyed by
 * table. This is the contract between `recordReviewStats` and the reversal
 * functions here: the drift-guard test in
 * convex/tests/features/schedulingUndo.test.ts snapshots every table listed
 * here, runs a review + undo through the real mutations, and fails on any
 * field that changed and is neither restored nor named below. Adding a new
 * stat to the record path therefore forces a decision. Reverse it, or add
 * it here explicitly.
 */
export const UNREVERSED_STAT_FIELDS: Record<string, readonly string[]> = {
  courseStats: [
    'totalTimeMs',
    'currentStreak',
    'lastActivityDate',
    'timezone',
    'streakFreezeCount',
    'streakFreezeUsedDate',
    'totalWordCount',
  ],
  dailyStats: ['timeMs', 'timeMsByMode', 'lastCelebratedAtCount'],
  weeklyStats: ['totalTimeMs', 'activeDays'],
  monthlyStats: ['totalTimeMs', 'activeDays', 'activeWeeks'],
  yearlyStats: ['totalTimeMs', 'activeDays', 'activeWeeks', 'activeMonths'],
  dailyLanguageStats: ['timeMs', 'newWordsCount'],
  languageStats: ['totalTimeMs', 'totalWords'],
  reviewDepthAccuracy: [],
  collectionProgress: [],
};

const dec = (value: number | undefined, by = 1): number =>
  Math.max(0, (value ?? 0) - by);

type ModeCounts = {
  audio: number;
  full: number;
  radio?: number;
  freeStudy?: number;
};

function decModeCount(
  counts: ModeCounts | undefined,
  mode: StatsReviewMode,
): ModeCounts | undefined {
  if (!counts) return undefined;
  return { ...counts, [mode]: dec(counts[mode]) };
}

/** Reverse the weekly/monthly/yearly rollups shared by both review kinds. */
async function reversePeriodRollups(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    date: string;
    wasFirstReview: boolean;
    /** Mode to decrement in `reviewsByMode`, or undefined when the original
     * upsert was called without a mode (and therefore didn't bump it). */
    reviewMode?: StatsReviewMode;
  },
): Promise<void> {
  const reversalPatch = (row: {
    totalRepetitions: number;
    totalNewCards: number;
    reviewsByMode?: ModeCounts;
  }) => ({
    totalRepetitions: dec(row.totalRepetitions),
    ...(args.wasFirstReview ? { totalNewCards: dec(row.totalNewCards) } : {}),
    ...(args.reviewMode
      ? { reviewsByMode: decModeCount(row.reviewsByMode, args.reviewMode) }
      : {}),
  });

  const weekly = await ctx.db
    .query('weeklyStats')
    .withIndex('by_userId_and_courseId_and_week', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('week', getISOWeekString(args.date)),
    )
    .first();
  if (weekly) await ctx.db.patch(weekly._id, reversalPatch(weekly));

  const monthly = await ctx.db
    .query('monthlyStats')
    .withIndex('by_userId_and_courseId_and_month', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('month', getMonthString(args.date)),
    )
    .first();
  if (monthly) await ctx.db.patch(monthly._id, reversalPatch(monthly));

  const yearly = await ctx.db
    .query('yearlyStats')
    .withIndex('by_userId_and_courseId_and_year', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('year', getYearString(args.date)),
    )
    .first();
  if (yearly) await ctx.db.patch(yearly._id, reversalPatch(yearly));
}

/** Reverse the stat increments of one logged card review (kind 'review'). */
export async function reverseReviewStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    log: Doc<'reviewLogs'>;
  },
): Promise<void> {
  const { userId, courseId, log } = args;
  const reversal = log.statsReversal;
  if (!reversal) return;
  const {
    hourOfDay,
    rating,
    reviewModeForStats,
    reviewModeRaw,
    wasFirstReview,
    wasDefaultRating,
    accuracy,
    accuracyStrict,
    accuracyLenient,
    reviewDepth,
    collectionId,
    newCardOrigin,
  } = reversal;

  // --- Course-level stats ---
  const stats = await getCourseStatsForMutation(ctx, userId, courseId);
  if (stats) {
    await ctx.db.patch(stats._id, {
      totalRepetitions: dec(stats.totalRepetitions),
      ...(wasFirstReview ? { totalCards: dec(stats.totalCards) } : {}),
      ...(reviewModeRaw
        ? {
            totalReviewsByMode: decModeCount(
              stats.totalReviewsByMode,
              reviewModeRaw,
            ),
          }
        : {}),
      ...(accuracy != null
        ? {
            totalAccuracySum: Math.max(
              0,
              (stats.totalAccuracySum ?? 0) - accuracy,
            ),
            totalAccuracyCount: dec(stats.totalAccuracyCount),
          }
        : {}),
      ...(accuracyStrict != null && accuracyLenient != null
        ? {
            totalAccuracyStrictSum: Math.max(
              0,
              (stats.totalAccuracyStrictSum ?? 0) - accuracyStrict,
            ),
            totalAccuracyLenientSum: Math.max(
              0,
              (stats.totalAccuracyLenientSum ?? 0) - accuracyLenient,
            ),
            totalAccuracyDualCount: dec(stats.totalAccuracyDualCount),
          }
        : {}),
    });
  }

  // --- Daily stats @ the day the review was recorded under ---
  const daily = await getDailyStats(ctx, userId, courseId, log.date);
  if (daily) {
    let hourBuckets: number[] | undefined;
    if (daily.hourBuckets && hourOfDay >= 0 && hourOfDay < 24) {
      hourBuckets = [...daily.hourBuckets];
      hourBuckets[hourOfDay] = dec(hourBuckets[hourOfDay]);
    }

    let ratingCounts: Doc<'dailyStats'>['ratingCounts'];
    if (daily.ratingCounts && rating in daily.ratingCounts) {
      ratingCounts = {
        ...daily.ratingCounts,
        [rating]: dec(daily.ratingCounts[rating]),
      };
    }

    // Prefer the bucket stamped at review time: it is the only value that
    // survives the writing track's lazy-seed path, where the review was
    // scheduled from a COPY of the shared fsrsState but `prevWriting` records
    // the true (unset) writing fields that undo has to restore. Re-deriving
    // there decrements 'new' while the increment landed elsewhere, skewing the
    // day permanently. The derivation below is the fallback for logs written
    // before `cardState` existed.
    const derivedFsrsState =
      (log.track ?? 'shared') === 'writing'
        ? log.prevWriting?.writingFsrsState
        : log.prevCard?.fsrsState;
    const cardStateIndex =
      log.statsReversal?.cardState ?? derivedFsrsState?.state ?? 0;
    const cardStateKey = FSRS_STATE_LABELS[cardStateIndex] ?? 'new';
    const reviewsByCardState = daily.reviewsByCardState
      ? {
          ...daily.reviewsByCardState,
          [cardStateKey]: dec(daily.reviewsByCardState[cardStateKey]),
        }
      : undefined;

    await ctx.db.patch(daily._id, {
      reps: dec(daily.reps),
      cardsReviewed: dec(daily.cardsReviewed),
      ...(wasFirstReview ? { newCards: dec(daily.newCards) } : {}),
      // Only when the row actually carries a split. A first review logged
      // before `newCardsByOrigin` existed has no bucket to give back, and
      // seeding one here would fabricate a negative-space split on a row whose
      // buckets are already known not to sum to `newCards`.
      ...(wasFirstReview && newCardOrigin && daily.newCardsByOrigin
        ? {
            newCardsByOrigin: {
              ...daily.newCardsByOrigin,
              [newCardOrigin]: dec(daily.newCardsByOrigin[newCardOrigin]),
            },
          }
        : {}),
      ...(hourBuckets ? { hourBuckets } : {}),
      ...(ratingCounts ? { ratingCounts } : {}),
      ...(reviewsByCardState ? { reviewsByCardState } : {}),
      reviewsByMode: decModeCount(daily.reviewsByMode, reviewModeForStats),
      ...(accuracy != null
        ? {
            accuracySum: Math.max(0, (daily.accuracySum ?? 0) - accuracy),
            accuracyCount: dec(daily.accuracyCount),
          }
        : {}),
      ...(accuracyStrict != null && accuracyLenient != null
        ? {
            accuracyStrictSum: Math.max(
              0,
              (daily.accuracyStrictSum ?? 0) - accuracyStrict,
            ),
            accuracyLenientSum: Math.max(
              0,
              (daily.accuracyLenientSum ?? 0) - accuracyLenient,
            ),
            accuracyDualCount: dec(daily.accuracyDualCount),
          }
        : {}),
      ...(wasDefaultRating === true
        ? { defaultRatingUsed: dec(daily.defaultRatingUsed) }
        : {}),
      ...(wasDefaultRating === false
        ? { defaultRatingChanged: dec(daily.defaultRatingChanged) }
        : {}),
    });
  }

  // --- Weekly / monthly / yearly (these gate reviewsByMode on the RAW mode,
  // matching the presence-gated increment in recordReviewStats) ---
  await reversePeriodRollups(ctx, {
    userId,
    courseId,
    date: log.date,
    wasFirstReview,
    reviewMode: reviewModeRaw,
  });

  // --- Per-language stats (time and word counts stay) ---
  for (const language of reversal.languages) {
    const dailyLang = await ctx.db
      .query('dailyLanguageStats')
      .withIndex('by_userId_and_courseId_and_language_and_date', (q) =>
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('language', language)
          .eq('date', log.date),
      )
      .first();
    if (dailyLang) {
      await ctx.db.patch(dailyLang._id, {
        reps: dec(dailyLang.reps),
        ...(wasFirstReview ? { newCards: dec(dailyLang.newCards) } : {}),
      });
    }
    const langStats = await ctx.db
      .query('languageStats')
      .withIndex('by_userId_and_courseId_and_language', (q) =>
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('language', language),
      )
      .first();
    if (langStats) {
      await ctx.db.patch(langStats._id, {
        totalRepetitions: dec(langStats.totalRepetitions),
        ...(wasFirstReview
          ? { totalNewCards: dec(langStats.totalNewCards) }
          : {}),
      });
    }
  }

  // --- Accuracy by review depth ---
  if (accuracy != null && reviewDepth != null) {
    const depthRow = await ctx.db
      .query('reviewDepthAccuracy')
      .withIndex('by_userId_and_courseId_and_reviewNumber', (q) =>
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('reviewNumber', reviewDepth),
      )
      .first();
    if (depthRow) {
      await ctx.db.patch(depthRow._id, {
        accuracySum: Math.max(0, depthRow.accuracySum - accuracy),
        count: dec(depthRow.count),
      });
    }
  }

  // --- Collection progress (only bumped on first review; normally monotonic,
  // but undo makes the review "never have happened") ---
  if (wasFirstReview && collectionId) {
    const progress = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('collectionId', collectionId),
      )
      .first();
    if (progress) {
      await ctx.db.patch(progress._id, {
        cardsLearned: dec(progress.cardsLearned),
      });
    }
  }
}

/** Reverse the stat increments of one logged free play (kind 'radio' or 'freeStudy'). */
export async function reverseFreePlayStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    log: Doc<'reviewLogs'>;
    mode: Extract<StatsReviewMode, 'radio' | 'freeStudy'>;
  },
): Promise<void> {
  const { userId, courseId, log, mode } = args;

  const stats = await getCourseStatsForMutation(ctx, userId, courseId);
  if (stats) {
    await ctx.db.patch(stats._id, {
      totalRepetitions: dec(stats.totalRepetitions),
      totalReviewsByMode: decModeCount(stats.totalReviewsByMode, mode),
    });
  }

  // recordFreePlayStats goes through upsertDailyStats, which bumps reps AND
  // cardsReviewed for free plays too. Mirror both.
  const daily = await getDailyStats(ctx, userId, courseId, log.date);
  if (daily) {
    await ctx.db.patch(daily._id, {
      reps: dec(daily.reps),
      cardsReviewed: dec(daily.cardsReviewed),
      reviewsByMode: decModeCount(daily.reviewsByMode, mode),
    });
  }

  await reversePeriodRollups(ctx, {
    userId,
    courseId,
    date: log.date,
    wasFirstReview: false,
    reviewMode: mode,
  });
}

/**
 * Today's counters after a reversal, matching the shape `reviewCard` returns
 * so the client can sync its local state the same way. Computed for TODAY in
 * the caller's current timezone (not the log's date), after a day rollover
 * the reversal targets yesterday's rows and today's counters are unaffected.
 */
export async function readTodayCounters(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    timezone: string;
    targetLanguages: readonly string[];
  },
): Promise<{
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
}> {
  const today = getTodayInTimezone(args.timezone);
  const daily = await getDailyStats(ctx, args.userId, args.courseId, today);
  const dailyReviewsToday = displayedActiveReviews(daily);
  const dailyTimeMsToday = daily?.timeMs ?? 0;

  // Target-only new-word count. Mirrors `recordReviewStats`'s definition of
  // `dailyNewWordsToday` (base languages aren't "new vocabulary").
  let dailyNewWordsToday = 0;
  for (const language of new Set(args.targetLanguages)) {
    const row = await ctx.db
      .query('dailyLanguageStats')
      .withIndex('by_userId_and_courseId_and_language_and_date', (q) =>
        q
          .eq('userId', args.userId)
          .eq('courseId', args.courseId)
          .eq('language', language)
          .eq('date', today),
      )
      .first();
    dailyNewWordsToday += row?.newWordsCount ?? 0;
  }

  return { dailyReviewsToday, dailyTimeMsToday, dailyNewWordsToday };
}

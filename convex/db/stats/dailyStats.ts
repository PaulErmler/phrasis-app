import { QueryCtx, MutationCtx } from '../../_generated/server';
import { Id, Doc } from '../../_generated/dataModel';
import { getCourseStatsForMutation } from '../courseStats';
import { getTodayInTimezone } from '../../lib/dateUtils';
import { FSRS_STATE_LABELS as CARD_STATE_KEYS } from '../../lib/fsrsStates';
import type { StatsReviewMode } from '../../types';

export async function getDailyStats(
  ctx: QueryCtx,
  userId: string,
  courseId: Id<'courses'>,
  date: string,
): Promise<Doc<'dailyStats'> | null> {
  return ctx.db
    .query('dailyStats')
    .withIndex('by_userId_and_courseId_and_date', (q) =>
      q.eq('userId', userId).eq('courseId', courseId).eq('date', date),
    )
    .first();
}


/**
 * Floor a displayed review count to the celebration high-water mark (which
 * undo deliberately never lowers): after undoing past a milestone the
 * progress bar stays put, and re-reviewing those cards doesn't visibly
 * advance it or replay the celebration. Single owner of the formula.
 * `getCardForReview`, `reviewCard`, and `readTodayCounters` must all agree
 * or the bar jumps between initial load, post-review, and post-undo syncs.
 */
export function floorToCelebration(
  activeReviews: number,
  lastCelebratedAtCount: number | null | undefined,
): number {
  return Math.max(activeReviews, lastCelebratedAtCount ?? 0);
}

/**
 * The review count shown in the progress bar for a day: active (non-radio)
 * reviews floored to the celebration high-water mark. Tolerates a missing
 * row (no activity today yet).
 */
export function displayedActiveReviews(
  daily:
    | Pick<Doc<'dailyStats'>, 'reviewsByMode' | 'lastCelebratedAtCount'>
    | null
    | undefined,
): number {
  return floorToCelebration(
    (daily?.reviewsByMode?.audio ?? 0) + (daily?.reviewsByMode?.full ?? 0),
    daily?.lastCelebratedAtCount,
  );
}

const EMPTY_HOUR_BUCKETS = () => Array.from({ length: 24 }, () => 0);
const EMPTY_RATING_COUNTS = () => ({
  stillLearning: 0, understood: 0,
  again: 0, hard: 0, good: 0, easy: 0,
});
/** Zeroed per-mode review counts; shared by the weekly/monthly/yearly upserts. */
export const EMPTY_MODE_COUNTS = () => ({ audio: 0, full: 0, radio: 0, freeStudy: 0 });
const EMPTY_CARD_STATE = () => ({ new: 0, learning: 0, review: 0, relearning: 0 });

export async function upsertDailyStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    date: string;
    timeMs: number;
    isNewCard: boolean;
    reviewMode?: StatsReviewMode;
    rating?: string;
    accuracy?: number;
    /** Written only as a pair, sharing `accuracyDualCount`. */
    accuracyStrict?: number;
    accuracyLenient?: number;
    wasDefaultRating?: boolean;
    hourOfDay?: number;
    cardState?: number; // 0=new, 1=learning, 2=review, 3=relearning
  },
): Promise<{
  isFirstActivityToday: boolean;
  repsAfter: number;
  timeMsAfter: number;
  /** Post-update count of non-radio reviews (audio + full). Drives the
   * celebration milestone and the in-learn progress bar so radio plays don't
   * inflate either. */
  activeReviewsAfter: number;
  /** High-water mark of the count when a celebration last fired today (0 when
   * none). Callers floor the DISPLAYED review count with it so undoing past a
   * milestone doesn't wind the progress bar back. */
  lastCelebratedAtCount: number;
}> {
  const existing = await ctx.db
    .query('dailyStats')
    .withIndex('by_userId_and_courseId_and_date', (q) =>
      q
        .eq('userId', args.userId)
        .eq('courseId', args.courseId)
        .eq('date', args.date),
    )
    .first();

  if (existing) {
    // Hour buckets
    let hourBuckets: number[] | undefined;
    if (args.hourOfDay != null && args.hourOfDay >= 0 && args.hourOfDay < 24) {
      hourBuckets = existing.hourBuckets ? [...existing.hourBuckets] : EMPTY_HOUR_BUCKETS();
      hourBuckets[args.hourOfDay] = (hourBuckets[args.hourOfDay] ?? 0) + 1;
    }

    // Rating counts
    type RatingCounts = { stillLearning: number; understood: number; again: number; hard: number; good: number; easy: number };
    let ratingCounts: RatingCounts | undefined;
    if (args.rating) {
      const prev = existing.ratingCounts ?? EMPTY_RATING_COUNTS();
      if (args.rating in prev) {
        const key = args.rating as keyof RatingCounts;
        ratingCounts = { ...prev, [key]: prev[key] + 1 };
      }
    }

    // Mode counts. `radio`/`freeStudy` are optional in the stored shape
    // (added later), so we coalesce both the merged previous shape and the
    // per-key read.
    type ModeCounts = { audio: number; full: number; radio: number; freeStudy: number };
    let reviewsByMode: ModeCounts | undefined;
    let timeMsByMode: ModeCounts | undefined;
    if (args.reviewMode) {
      const prevReviews: ModeCounts = {
        ...EMPTY_MODE_COUNTS(),
        ...(existing.reviewsByMode ?? {}),
      };
      reviewsByMode = { ...prevReviews, [args.reviewMode]: prevReviews[args.reviewMode] + 1 };
      const prevTime: ModeCounts = {
        ...EMPTY_MODE_COUNTS(),
        ...(existing.timeMsByMode ?? {}),
      };
      timeMsByMode = { ...prevTime, [args.reviewMode]: prevTime[args.reviewMode] + args.timeMs };
    }

    // Card state
    let reviewsByCardState: { new: number; learning: number; review: number; relearning: number } | undefined;
    if (args.cardState != null) {
      const key = CARD_STATE_KEYS[args.cardState] ?? 'new';
      const prev = existing.reviewsByCardState ?? EMPTY_CARD_STATE();
      reviewsByCardState = { ...prev, [key]: prev[key] + 1 };
    }

    const repsAfter = existing.reps + 1;
    const timeMsAfter = existing.timeMs + args.timeMs;
    await ctx.db.patch(existing._id, {
      reps: repsAfter,
      timeMs: timeMsAfter,
      newCards: existing.newCards + (args.isNewCard ? 1 : 0),
      cardsReviewed: existing.cardsReviewed + 1,
      ...(hourBuckets ? { hourBuckets } : {}),
      ...(ratingCounts ? { ratingCounts } : {}),
      ...(reviewsByMode ? { reviewsByMode } : {}),
      ...(timeMsByMode ? { timeMsByMode } : {}),
      ...(reviewsByCardState ? { reviewsByCardState } : {}),
      ...(args.accuracy != null
        ? {
          accuracySum: (existing.accuracySum ?? 0) + args.accuracy,
          accuracyCount: (existing.accuracyCount ?? 0) + 1,
        }
        : {}),
      ...(args.accuracyStrict != null && args.accuracyLenient != null
        ? {
          accuracyStrictSum: (existing.accuracyStrictSum ?? 0) + args.accuracyStrict,
          accuracyLenientSum: (existing.accuracyLenientSum ?? 0) + args.accuracyLenient,
          accuracyDualCount: (existing.accuracyDualCount ?? 0) + 1,
        }
        : {}),
      ...(args.wasDefaultRating === true
        ? { defaultRatingUsed: (existing.defaultRatingUsed ?? 0) + 1 }
        : {}),
      ...(args.wasDefaultRating === false
        ? { defaultRatingChanged: (existing.defaultRatingChanged ?? 0) + 1 }
        : {}),
    });
    const modeAfter = reviewsByMode ?? existing.reviewsByMode;
    const activeReviewsAfter = (modeAfter?.audio ?? 0) + (modeAfter?.full ?? 0);
    return {
      isFirstActivityToday: false,
      repsAfter,
      timeMsAfter,
      activeReviewsAfter,
      lastCelebratedAtCount: existing.lastCelebratedAtCount ?? 0,
    };
  }

  // Insert new document
  const hourBuckets = EMPTY_HOUR_BUCKETS();
  if (args.hourOfDay != null && args.hourOfDay >= 0 && args.hourOfDay < 24) hourBuckets[args.hourOfDay] = 1;

  const ratingCounts = EMPTY_RATING_COUNTS();
  if (args.rating && args.rating in ratingCounts) {
    (ratingCounts as Record<string, number>)[args.rating] = 1;
  }

  const cardState = EMPTY_CARD_STATE();
  if (args.cardState != null) {
    const key = CARD_STATE_KEYS[args.cardState] ?? 'new';
    cardState[key] = 1;
  }

  await ctx.db.insert('dailyStats', {
    userId: args.userId,
    courseId: args.courseId,
    date: args.date,
    reps: 1,
    timeMs: args.timeMs,
    newCards: args.isNewCard ? 1 : 0,
    cardsReviewed: 1,
    hourBuckets,
    ratingCounts,
    reviewsByCardState: cardState,
    ...(args.reviewMode
      ? {
        reviewsByMode: {
          ...EMPTY_MODE_COUNTS(),
          [args.reviewMode]: 1,
        },
        timeMsByMode: {
          ...EMPTY_MODE_COUNTS(),
          [args.reviewMode]: args.timeMs,
        },
      }
      : {}),
    ...(args.accuracy != null ? { accuracySum: args.accuracy, accuracyCount: 1 } : {}),
    ...(args.accuracyStrict != null && args.accuracyLenient != null
      ? {
        accuracyStrictSum: args.accuracyStrict,
        accuracyLenientSum: args.accuracyLenient,
        accuracyDualCount: 1,
      }
      : {}),
    ...(args.wasDefaultRating === true ? { defaultRatingUsed: 1, defaultRatingChanged: 0 } : {}),
    ...(args.wasDefaultRating === false ? { defaultRatingUsed: 0, defaultRatingChanged: 1 } : {}),
  });
  const activeReviewsAfter =
    args.reviewMode === 'audio' || args.reviewMode === 'full' ? 1 : 0;
  return {
    isFirstActivityToday: true,
    repsAfter: 1,
    timeMsAfter: args.timeMs,
    activeReviewsAfter,
    lastCelebratedAtCount: 0,
  };
}

/**
 * Increment a single event counter on dailyStats without touching review fields.
 * Pass `count` to add more than 1 at a time (used by bulk flows like the
 * custom-text importer).
 */
export async function incrementDailyEventCounter(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    date: string;
    field: 'chatMessagesSent' | 'chatCardsApproved' | 'cardsEdited' | 'cardsAddedManually';
    count?: number;
  },
): Promise<void> {
  const amount = args.count ?? 1;
  if (amount <= 0) return;
  const existing = await ctx.db
    .query('dailyStats')
    .withIndex('by_userId_and_courseId_and_date', (q) =>
      q.eq('userId', args.userId).eq('courseId', args.courseId).eq('date', args.date),
    )
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      [args.field]: ((existing[args.field] as number | undefined) ?? 0) + amount,
    });
  } else {
    await ctx.db.insert('dailyStats', {
      userId: args.userId,
      courseId: args.courseId,
      date: args.date,
      reps: 0,
      newCards: 0,
      timeMs: 0,
      cardsReviewed: 0,
      [args.field]: amount,
    });
  }
}

type DailyField = 'chatMessagesSent' | 'chatCardsApproved' | 'cardsEdited' | 'cardsAddedManually';

const DAILY_TO_TOTAL_MAP: Record<DailyField, keyof Doc<'courseStats'>> = {
  chatMessagesSent: 'totalChatMessages',
  chatCardsApproved: 'totalChatCardsApproved',
  cardsEdited: 'totalCardsEdited',
  cardsAddedManually: 'totalCardsAddedManually',
};

/**
 * Track a user event by incrementing both the daily counter and the
 * cumulative courseStats total in one call. Pass `count` > 1 for bulk flows
 * (e.g. importing many custom cards at once) to avoid doing N round-trips.
 *
 * Timezone is optional, if omitted, it's read from courseStats.timezone
 * (set during card reviews). Falls back to 'UTC' if neither is available.
 */
export async function trackEvent(
  ctx: MutationCtx,
  args: {
    userId: string;
    courseId: Id<'courses'>;
    timezone?: string;
    field: DailyField;
    count?: number;
  },
): Promise<void> {
  const amount = args.count ?? 1;
  if (amount <= 0) return;
  const stats = await getCourseStatsForMutation(ctx, args.userId, args.courseId);
  const tz = args.timezone || stats?.timezone || 'UTC';
  const date = getTodayInTimezone(tz);
  await incrementDailyEventCounter(ctx, {
    userId: args.userId,
    courseId: args.courseId,
    date,
    field: args.field,
    count: amount,
  });
  if (stats) {
    const totalField = DAILY_TO_TOTAL_MAP[args.field];
    await ctx.db.patch(stats._id, {
      [totalField]: ((stats[totalField] as number | undefined) ?? 0) + amount,
    });
  }
}

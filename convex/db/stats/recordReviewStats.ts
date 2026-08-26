import { MutationCtx } from '../../_generated/server';
import { Doc } from '../../_generated/dataModel';
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
import { upsertDailyLanguageStats } from './dailyLanguageStats';
import { upsertLanguageStats } from './languageStats';
import { upsertReviewDepthAccuracy } from './reviewDepthAccuracy';
import { trackNewWords } from './wordTracking';
import type { SchedulingTrack } from '../../types';
// Shared with the per-card running averages (cards.reviewTimeStats) so the
// daily time series and the per-card means clamp samples identically.
import { REVIEW_TIME_CLAMP_MAX_MS as MAX_TIME_PER_CARD_MS } from '../../lib/reviewTimeStats';

/**
 * Record all statistics for a card review: course stats, daily/weekly/monthly/yearly
 * aggregates, per-language stats, word tracking, accuracy, and collection progress.
 *
 * Returns the new `wordsTrackedLanguages` value when word tracking ran for any
 * previously-untracked languages on this card. The caller is expected to merge
 * it into the same `patchCard` call that updates scheduling state, so we don't
 * double-write the card document.
 *
 * Pass `text` when the caller already has the card's text doc. Avoids a
 * redundant `ctx.db.get(card.textId)` inside word tracking.
 */
export async function recordReviewStats(
  ctx: MutationCtx,
  args: {
    userId: string;
    card: Doc<'cards'>;
    deck: Doc<'decks'>;
    course: Doc<'courses'>;
    timezone: string;
    timeSpentMs?: number;
    reviewMode?: 'audio' | 'full';
    /** Which per-card schedule the review wrote (default 'shared'). Selects
     * the state the card-derived stats read: FSRS-state bucket and review
     * depth come from the writing track for writing-track reviews. */
    track?: SchedulingTrack;
    /** The FSRS state the review was actually scheduled FROM, resolved by
     * the caller. Matters on the writing track's lazy-seed path, where
     * scheduling continues from a COPY of the shared state while the card's
     * own `writingFsrsState` is still unset. Reading the raw card would
     * bucket a mature card as 'new' at depth 1 there, inconsistent with the
     * identical backfill-seeded card. Null when the review started outside
     * FSRS (pre-review phase). */
    priorFsrsState?: Doc<'cards'>['fsrsState'] | null;
    rating: string;
    accuracy?: number;
    /** Written only as a pair. See the courseStats patch below. */
    accuracyStrict?: number;
    accuracyLenient?: number;
    wasDefaultRating?: boolean;
    text?: Doc<'texts'> | null;
    sessionId?: string;
  },
): Promise<{
  newWordsTrackedLanguages?: string[];
  dailyReviewsToday: number;
  dailyTimeMsToday: number;
  dailyNewWordsToday: number;
  // Keys the review's stat increments were bucketed under. Captured for the
  // reviewLogs undo entry, since they aren't recomputable later (clock moves
  // on, course languages can change).
  todayDate: string;
  hourOfDay: number;
  languages: string[];
  wasFirstReview: boolean;
  /** See `upsertDailyStats`. Floors the displayed review count so undo can't
   * wind the progress bar back past an already-shown celebration. */
  lastCelebratedAtCount: number;
}> {
  const { userId, card, deck, course } = args;
  const nonNegativeTime = Math.max(args.timeSpentMs ?? 0, 0);
  const clampedTime = Math.min(nonNegativeTime, MAX_TIME_PER_CARD_MS);

  const stats = await getCourseStatsForMutation(ctx, userId, deck.courseId);
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

  const track: SchedulingTrack = args.track ?? 'shared';

  // "First review" means first on EITHER track. With separateModeTracking a
  // card's tracks advance independently, so checking only the reviewed track
  // would count the same card as "new" twice (once per track) in totalCards /
  // newCards / collectionProgress.cardsLearned.
  //
  // Both checks deliberately derive from review COUNTS, never from
  // `lastReviewedAt` timestamps: free play stamps `lastReviewedAt` on mere
  // plays (and the seed used to copy it into `writingLastReviewedAt`), so a
  // timestamp check would permanently rob free-played cards of their
  // first-review increment. Writing reviews always run through FSRS, so
  // `writingFsrsState.reps === 0` ⇔ never writing-reviewed (a seeded mature
  // card carries the shared reps. Correctly "not new", since its shared
  // check is false too).
  const sharedNeverReviewed =
    card.schedulingPhase === 'preReview' && card.preReviewCount === 0;
  const writingNeverReviewed = (card.writingFsrsState?.reps ?? 0) === 0;
  const isFirstReview = sharedNeverReviewed && writingNeverReviewed;

  const hourOfDay = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: args.timezone,
      hour: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    }).format(new Date()),
  );

  // Card FSRS state: 0=new, 1=learning, 2=review, 3=relearning. The state
  // the review was scheduled FROM (caller-resolved; see priorFsrsState).
  // Falls back to the raw card for legacy callers that don't pass it.
  const priorFsrsState =
    args.priorFsrsState !== undefined
      ? args.priorFsrsState
      : track === 'writing'
        ? card.writingFsrsState ?? null
        : card.fsrsState ?? null;
  const fsrsCardState = priorFsrsState?.state ?? 0;

  // --- Course-level stats ---
  const prevModeReviews = stats.totalReviewsByMode ?? { audio: 0, full: 0 };
  await ctx.db.patch(stats._id, {
    totalRepetitions: stats.totalRepetitions + 1,
    totalTimeMs: stats.totalTimeMs + clampedTime,
    totalCards: stats.totalCards + (isFirstReview ? 1 : 0),
    currentStreak: newStreak,
    lastActivityDate: newLastActivityDate,
    timezone: args.timezone,
    streakFreezeCount: newFreezeCount,
    streakFreezeUsedDate: newFreezeUsedDate,
    ...(args.reviewMode
      ? { totalReviewsByMode: { ...prevModeReviews, [args.reviewMode]: prevModeReviews[args.reviewMode] + 1 } }
      : {}),
    ...(args.accuracy != null
      ? {
        totalAccuracySum: (stats.totalAccuracySum ?? 0) + args.accuracy,
        totalAccuracyCount: (stats.totalAccuracyCount ?? 0) + 1,
      }
      : {}),
    // Gated on BOTH being present, independently of `accuracy` above: the two
    // sums share one count, so a half-written pair would desynchronise the
    // averages permanently.
    ...(args.accuracyStrict != null && args.accuracyLenient != null
      ? {
        totalAccuracyStrictSum: (stats.totalAccuracyStrictSum ?? 0) + args.accuracyStrict,
        totalAccuracyLenientSum: (stats.totalAccuracyLenientSum ?? 0) + args.accuracyLenient,
        totalAccuracyDualCount: (stats.totalAccuracyDualCount ?? 0) + 1,
      }
      : {}),
  });

  // --- Daily stats ---
  // `dailyReviewsToday` here is the non-radio review count (audio + full) so
  // that radio plays don't inflate the celebration milestone or the in-learn
  // progress bar. `repsAfter` (total reps incl. radio) is intentionally unused.
  // Default to 'audio' when the caller omits a mode. This path is the
  // active-review path (free play uses `recordFreePlayStats`), so the review
  // must count toward `reviewsByMode.audio`/`full` for the milestone math.
  const reviewModeForStats = args.reviewMode ?? 'audio';
  const {
    isFirstActivityToday,
    activeReviewsAfter: dailyReviewsToday,
    timeMsAfter: dailyTimeMsToday,
    lastCelebratedAtCount,
  } = await upsertDailyStats(ctx, {
    userId,
    courseId: deck.courseId,
    date: todayDate,
    timeMs: clampedTime,
    isNewCard: isFirstReview,
    reviewMode: reviewModeForStats,
    rating: args.rating,
    accuracy: args.accuracy,
    accuracyStrict: args.accuracyStrict,
    accuracyLenient: args.accuracyLenient,
    wasDefaultRating: args.wasDefaultRating,
    hourOfDay,
    cardState: fsrsCardState,
  });

  // --- Weekly / monthly / yearly aggregates ---
  const week = getISOWeekString(todayDate);
  const month = getMonthString(todayDate);
  const year = getYearString(todayDate);

  const { isFirstActivityThisWeek } = await upsertWeeklyStats(ctx, {
    userId,
    courseId: deck.courseId,
    week,
    timeMs: clampedTime,
    isNewCard: isFirstReview,
    reviewMode: args.reviewMode,
    isFirstActivityToday,
  });

  const { isFirstActivityThisMonth } = await upsertMonthlyStats(ctx, {
    userId,
    courseId: deck.courseId,
    month,
    timeMs: clampedTime,
    isNewCard: isFirstReview,
    reviewMode: args.reviewMode,
    isFirstActivityToday,
    isFirstActivityThisWeek,
  });

  await upsertYearlyStats(ctx, {
    userId,
    courseId: deck.courseId,
    year,
    timeMs: clampedTime,
    isNewCard: isFirstReview,
    reviewMode: args.reviewMode,
    isFirstActivityToday,
    isFirstActivityThisWeek,
    isFirstActivityThisMonth,
  });

  // --- Per-language stats + word tracking ---
  const allLanguages = [...new Set([...course.baseLanguages, ...course.targetLanguages])];
  const timePerLanguage = Math.round(clampedTime / allLanguages.length);

  // Determine which languages still need word tracking for this card.
  const trackedSet = new Set(card.wordsTrackedLanguages ?? []);
  const untrackedLanguages = allLanguages.filter((l) => !trackedSet.has(l));

  let newWordCounts: Record<string, number> = {};
  let totalNewWords = 0;
  let newWordsTrackedLanguages: string[] | undefined;

  if (untrackedLanguages.length > 0) {
    const text =
      args.text !== undefined ? args.text : await ctx.db.get(card.textId);
    if (text) {
      const langTexts: Array<{ language: string; text: string }> = [];
      // Include source text if its language is untracked
      if (untrackedLanguages.includes(text.language)) {
        langTexts.push({ language: text.language, text: text.text });
      }
      for (const lang of untrackedLanguages) {
        if (lang === text.language) continue;
        const translation = await ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', card.textId).eq('targetLanguage', lang),
          )
          .first();
        if (translation) {
          langTexts.push({ language: lang, text: translation.translatedText });
        }
      }
      if (langTexts.length > 0) {
        newWordCounts = await trackNewWords(ctx, {
          userId,
          courseId: deck.courseId,
          languages: langTexts,
          textId: card.textId,
          sessionId: args.sessionId,
        });
        for (const count of Object.values(newWordCounts)) {
          totalNewWords += count;
        }
      }

      // Hand the new stamp back to the caller so they can fold it into the
      // single `patchCard` call that updates scheduling state.
      newWordsTrackedLanguages = [...trackedSet, ...untrackedLanguages];
    }
  }

  // Sum each TARGET language's post-patch newWordsCount as we go, so we can
  // return today's total without an extra query at the end. Base languages
  // (the user's known languages) aren't counted as "new vocabulary". The
  // celebration's hero metric is target-only and `dailyNewWordsToday` must
  // match that definition.
  const targetLanguageSet = new Set(course.targetLanguages);
  let dailyNewWordsToday = 0;
  for (const lang of allLanguages) {
    const wordsForLang = newWordCounts[lang] ?? 0;
    const { newWordsCountAfter } = await upsertDailyLanguageStats(ctx, {
      userId,
      courseId: deck.courseId,
      date: todayDate,
      language: lang,
      timeMs: timePerLanguage,
      isNewCard: isFirstReview,
      newWordsCount: wordsForLang,
    });
    if (targetLanguageSet.has(lang)) {
      dailyNewWordsToday += newWordsCountAfter;
    }
    await upsertLanguageStats(ctx, {
      userId,
      courseId: deck.courseId,
      language: lang,
      timeMs: timePerLanguage,
      isNewCard: isFirstReview,
      newWordsCount: wordsForLang,
    });
  }

  if (totalNewWords > 0) {
    await ctx.db.patch(stats._id, {
      totalWordCount: (stats.totalWordCount ?? 0) + totalNewWords,
    });
  }

  // --- Accuracy by review depth ---
  if (args.accuracy != null) {
    // Writing track: depth counts writing-track reviews only (no pre-review
    // phase there), from the resolved prior state so a lazy-seeded review
    // reports the card's true depth rather than 1. Must stay in sync with
    // the `reviewDepth` stamped on the undo log in reviewCard.
    const reviewDepth =
      track === 'writing'
        ? (priorFsrsState?.reps ?? 0) + 1
        : card.preReviewCount + (priorFsrsState?.reps ?? 0) + 1;
    await upsertReviewDepthAccuracy(ctx, {
      userId,
      courseId: deck.courseId,
      reviewNumber: reviewDepth,
      accuracy: args.accuracy,
    });
  }

  // --- Collection progress (first review only) ---
  if (isFirstReview && card.collectionId) {
    const progress = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
        q.eq('userId', userId).eq('courseId', deck.courseId).eq('collectionId', card.collectionId!),
      )
      .first();
    if (progress) {
      await ctx.db.patch(progress._id, {
        cardsLearned: (progress.cardsLearned ?? 0) + 1,
      });
    }
  }

  return {
    newWordsTrackedLanguages,
    dailyReviewsToday,
    dailyTimeMsToday,
    dailyNewWordsToday,
    todayDate,
    hourOfDay,
    languages: allLanguages,
    wasFirstReview: isFirstReview,
    lastCelebratedAtCount,
  };
}

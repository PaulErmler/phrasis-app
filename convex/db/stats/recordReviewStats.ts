import { MutationCtx } from '../../_generated/server';
import { Doc, Id } from '../../_generated/dataModel';
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

const MAX_TIME_PER_CARD_MS = 180_000; // 3 minutes

/**
 * Record all statistics for a card review: course stats, daily/weekly/monthly/yearly
 * aggregates, per-language stats, word tracking, accuracy, and collection progress.
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
    rating: string;
    accuracy?: number;
    wasDefaultRating?: boolean;
  },
): Promise<void> {
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

  const isFirstReview =
    card.schedulingPhase === 'preReview' && card.preReviewCount === 0;

  const hourOfDay = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: args.timezone,
      hour: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    }).format(new Date()),
  );

  // Card FSRS state: 0=new, 1=learning, 2=review, 3=relearning
  const fsrsCardState = card.fsrsState?.state ?? 0;

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
  });

  // --- Daily stats ---
  const { isFirstActivityToday } = await upsertDailyStats(ctx, {
    userId,
    courseId: deck.courseId,
    date: todayDate,
    timeMs: clampedTime,
    isNewCard: isFirstReview,
    reviewMode: args.reviewMode,
    rating: args.rating,
    accuracy: args.accuracy,
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

  if (untrackedLanguages.length > 0) {
    const text = await ctx.db.get(card.textId);
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
        });
        for (const count of Object.values(newWordCounts)) {
          totalNewWords += count;
        }
      }

      // Stamp the card so these languages are not re-counted on future reviews
      const nowTracked = [...trackedSet, ...untrackedLanguages];
      await ctx.db.patch(card._id, { wordsTrackedLanguages: nowTracked });
    }
  }

  for (const lang of allLanguages) {
    const wordsForLang = newWordCounts[lang] ?? 0;
    await upsertDailyLanguageStats(ctx, {
      userId,
      courseId: deck.courseId,
      date: todayDate,
      language: lang,
      timeMs: timePerLanguage,
      isNewCard: isFirstReview,
      newWordsCount: wordsForLang,
    });
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
    const reviewDepth = card.preReviewCount + (card.fsrsState?.reps ?? 0) + 1;
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
}

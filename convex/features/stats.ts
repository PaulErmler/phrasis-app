import { v } from 'convex/values';
import { query, internalQuery } from '../_generated/server';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId } from '../db/decks';
import { cardsByState, cardsByDueDate, cardsByStateAndDueDate } from '../db/stats/cardAggregates';
import {
  getCourseStats as dbGetCourseStats,
  getTodayInTimezone,
} from '../db/courseStats';
import { getDailyStats } from '../db/stats/dailyStats';
import { EXTENDED_STATE_LABELS as STATE_LABELS } from '../lib/fsrsStates';

// Convention: query handlers return [] for array results and null for object results when unauthenticated.

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidWeekString(s: string): boolean {
  return /^\d{4}-W\d{2}$/.test(s);
}

function isValidMonthString(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s);
}

function isValidYearString(s: string): boolean {
  return /^\d{4}$/.test(s);
}

// ============================================================================
// STATS PAGE QUERIES
// ============================================================================

/**
 * Query 1: Small summary data — courseStats, todayStats, hourly distribution, monthly stats.
 * Loads fast, powers the numbers row, app usage, hourly chart, and line chart (year view).
 */
export const getStatsPageData = query({
  args: {
    timezone: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    startMonth: v.string(),
    endMonth: v.string(),
    startWeek: v.optional(v.string()),
    endWeek: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;

    const courseId = active.course._id;
    const baseLanguages = active.course.baseLanguages ?? [];

    // courseStats
    const stats = await dbGetCourseStats(ctx, userId, courseId);

    // todayStats
    const todayStr = getTodayInTimezone(args.timezone);
    const todayDaily = await getDailyStats(ctx, userId, courseId, todayStr);

    // hourly distribution (aggregate from dailyStats)
    const hourlyTotals = Array.from({ length: 24 }, () => 0);
    if (isValidDateString(args.startDate) && isValidDateString(args.endDate)) {
      const dailyRows = await ctx.db
        .query('dailyStats')
        .withIndex('by_userId_and_courseId_and_date', (q) =>
          q.eq('userId', userId).eq('courseId', courseId)
            .gte('date', args.startDate).lte('date', args.endDate),
        )
        .take(400);

      for (const row of dailyRows) {
        if (row.hourBuckets) {
          for (let i = 0; i < 24; i++) {
            hourlyTotals[i] += row.hourBuckets[i] ?? 0;
          }
        }
      }
    }

    // monthly stats
    let monthlyStats: Array<{
      month: string;
      totalRepetitions: number;
      totalNewCards: number;
      totalTimeMs: number;
    }> = [];
    if (isValidMonthString(args.startMonth) && isValidMonthString(args.endMonth)) {
      const rows = await ctx.db
        .query('monthlyStats')
        .withIndex('by_userId_and_courseId_and_month', (q) =>
          q.eq('userId', userId).eq('courseId', courseId)
            .gte('month', args.startMonth).lte('month', args.endMonth),
        )
        .take(24);

      monthlyStats = rows.map((r) => ({
        month: r.month,
        totalRepetitions: r.totalRepetitions,
        totalNewCards: r.totalNewCards,
        totalTimeMs: r.totalTimeMs,
      }));
    }

    // Weekly stats
    let weeklyStats: Array<{
      week: string;
      totalRepetitions: number;
      totalNewCards: number;
      totalTimeMs: number;
    }> = [];
    if (args.startWeek && args.endWeek && isValidWeekString(args.startWeek) && isValidWeekString(args.endWeek)) {
      const weekRows = await ctx.db
        .query('weeklyStats')
        .withIndex('by_userId_and_courseId_and_week', (q) =>
          q.eq('userId', userId).eq('courseId', courseId)
            .gte('week', args.startWeek!).lte('week', args.endWeek!),
        )
        .take(60);

      weeklyStats = weekRows.map((r) => ({
        week: r.week,
        totalRepetitions: r.totalRepetitions,
        totalNewCards: r.totalNewCards,
        totalTimeMs: r.totalTimeMs,
      }));
    }

    // Per-language word counts
    const langStatsRows = await ctx.db
      .query('languageStats')
      .withIndex('by_userId_and_courseId', (q) =>
        q.eq('userId', userId).eq('courseId', courseId),
      )
      .take(20);
    // Only include target languages, merging variants (e.g. es + es_latam)
    const targetLanguages = active.course.targetLanguages ?? [];
    const targetSet = new Set(targetLanguages.map((l) => l.replace(/_latam$/, '')));
    const wordsByLang = new Map<string, number>();
    for (const r of langStatsRows) {
      if (r.totalWords <= 0) continue;
      const key = r.language.replace(/_latam$/, '');
      if (!targetSet.has(key)) continue;
      wordsByLang.set(key, (wordsByLang.get(key) ?? 0) + r.totalWords);
    }
    const languageWordCounts = Array.from(wordsByLang.entries())
      .map(([language, words]) => ({ language, words }))
      .sort((a, b) => b.words - a.words);

    // Derive total from the filtered per-language counts (target languages only)
    const totalWordCount = languageWordCounts.reduce((sum, lw) => sum + lw.words, 0);

    return {
      courseStats: stats ? {
        totalRepetitions: stats.totalRepetitions,
        totalTimeMs: stats.totalTimeMs,
        totalCards: stats.totalCards,
        currentStreak: stats.currentStreak,
        totalWordCount,
        totalChatMessages: stats.totalChatMessages ?? 0,
        totalChatCardsApproved: stats.totalChatCardsApproved ?? 0,
        totalCardsAddedManually: stats.totalCardsAddedManually ?? 0,
        totalAccuracySum: stats.totalAccuracySum ?? 0,
        totalAccuracyCount: stats.totalAccuracyCount ?? 0,
      } : null,
      todayReps: todayDaily?.reps ?? 0,
      todayNewCards: todayDaily?.newCards ?? 0,
      todayTimeMs: todayDaily?.timeMs ?? 0,
      hourlyDistribution: hourlyTotals,
      monthlyStats,
      weeklyStats,
      baseLanguages,
      targetLanguages,
      languageWordCounts,
    };
  },
});

/**
 * Query 2: Heavier daily data — heatmap entries + per-language daily stats.
 * Powers the heatmap, line chart (week/month views), and per-language words chart.
 */
export const getStatsPageDailyData = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isValidDateString(args.startDate) || !isValidDateString(args.endDate)) {
      return { heatmapData: [], languageDailyData: [] };
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) return { heatmapData: [], languageDailyData: [] };
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { heatmapData: [], languageDailyData: [] };

    const courseId = active.course._id;

    // Heatmap data from dailyStats
    const dailyRows = await ctx.db
      .query('dailyStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q.eq('userId', userId).eq('courseId', courseId)
          .gte('date', args.startDate).lte('date', args.endDate),
      )
      .take(400);

    const heatmapData = dailyRows.map((r) => ({
      date: r.date,
      reps: r.reps,
      timeMs: r.timeMs,
      newCards: r.newCards,
    }));

    // Daily language stats
    const langRows = await ctx.db
      .query('dailyLanguageStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q.eq('userId', userId).eq('courseId', courseId)
          .gte('date', args.startDate).lte('date', args.endDate),
      )
      .take(2000);

    const languageDailyData = langRows.map((r) => ({
      date: r.date,
      language: r.language,
      newWordsCount: r.newWordsCount,
    }));

    return { heatmapData, languageDailyData };
  },
});

/**
 * Query 3: Recent words per target language for the word cloud.
 */
export const getRecentWords = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    const targetLanguages = active.course.targetLanguages ?? [];
    // Dedupe variants (e.g. es + es_latam → es)
    const seen = new Set<string>();
    const langPairs: Array<{ normalized: string; raw: string }> = [];
    for (const lang of targetLanguages) {
      const norm = lang.replace(/_latam$/, '');
      if (!seen.has(norm)) {
        seen.add(norm);
        langPairs.push({ normalized: norm, raw: lang });
      }
    }

    const result: Array<{ language: string; words: string[] }> = [];

    for (const { normalized, raw } of langPairs) {
      // Try both the raw and normalized variants
      const variants = normalized !== raw ? [raw, normalized] : [raw];
      const allWords: string[] = [];

      for (const variant of variants) {
        const rows = await ctx.db
          .query('userWords')
          .withIndex('by_userId_and_language', (q) =>
            q.eq('userId', userId).eq('language', variant),
          )
          .order('desc')
          .take(500);
        allWords.push(...rows.map((r) => r.word));
      }

      if (allWords.length > 0) {
        result.push({ language: normalized, words: allWords.slice(0, 500) });
      }
    }

    return result;
  },
});

// ============================================================================
// INTERNAL QUERIES — currently unused by the UI but retained for future use
// (e.g. expanded stats views, admin dashboards, data exports).
// These are internal so they don't pollute the public API surface.
// ============================================================================

/** Full dailyStats documents for a date range. */
export const getStatsForRange = internalQuery({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isValidDateString(args.startDate) || !isValidDateString(args.endDate)) return [];
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    return ctx.db
      .query('dailyStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id)
          .gte('date', args.startDate).lte('date', args.endDate),
      )
      .take(400);
  },
});

/** Weekly stats for a week range (ISO 8601 "YYYY-Www"). */
export const getWeeklyStatsRange = internalQuery({
  args: {
    startWeek: v.string(),
    endWeek: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isValidWeekString(args.startWeek) || !isValidWeekString(args.endWeek)) return [];
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    return ctx.db
      .query('weeklyStats')
      .withIndex('by_userId_and_courseId_and_week', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id)
          .gte('week', args.startWeek).lte('week', args.endWeek),
      )
      .take(60);
  },
});

/** Yearly stats for a year range ("YYYY"). */
export const getYearlyStatsRange = internalQuery({
  args: {
    startYear: v.string(),
    endYear: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isValidYearString(args.startYear) || !isValidYearString(args.endYear)) return [];
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    return ctx.db
      .query('yearlyStats')
      .withIndex('by_userId_and_courseId_and_year', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id)
          .gte('year', args.startYear).lte('year', args.endYear),
      )
      .take(10);
  },
});

/** All-time per-language totals. */
export const getLanguageStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    return ctx.db
      .query('languageStats')
      .withIndex('by_userId_and_courseId', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id),
      )
      .take(20);
  },
});

/** Rating distribution (stillLearning, understood, again, hard, good, easy) for a date range. */
export const getRatingDistribution = internalQuery({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isValidDateString(args.startDate) || !isValidDateString(args.endDate)) return null;
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;

    const rows = await ctx.db
      .query('dailyStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id)
          .gte('date', args.startDate).lte('date', args.endDate),
      )
      .take(400);

    const totals = { stillLearning: 0, understood: 0, again: 0, hard: 0, good: 0, easy: 0 };
    for (const row of rows) {
      if (row.ratingCounts) {
        for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] += row.ratingCounts[key] ?? 0;
        }
      }
    }
    return totals;
  },
});

/** Accuracy curve by review depth (review number → average accuracy). */
export const getAccuracyByReviewDepth = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    const rows = await ctx.db
      .query('reviewDepthAccuracy')
      .withIndex('by_userId_and_courseId', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id),
      )
      .take(100);

    return rows.map((r) => ({
      reviewNumber: r.reviewNumber,
      averageAccuracy: r.count > 0 ? r.accuracySum / r.count : 0,
      count: r.count,
    }));
  },
});

/** Reviews broken down by card FSRS state for a date range. */
export const getCardStateDistribution = internalQuery({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    if (!isValidDateString(args.startDate) || !isValidDateString(args.endDate)) return null;
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;

    const rows = await ctx.db
      .query('dailyStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id)
          .gte('date', args.startDate).lte('date', args.endDate),
      )
      .take(400);

    const totals = { new: 0, learning: 0, review: 0, relearning: 0 };
    for (const row of rows) {
      if (row.reviewsByCardState) {
        for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] += row.reviewsByCardState[key] ?? 0;
        }
      }
    }
    return totals;
  },
});

/** Learning progress per collection (cards added/learned vs total). */
export const getCollectionLearningProgress = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    const rows = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId', (q) =>
        q.eq('userId', userId).eq('courseId', active.course._id),
      )
      .take(50);

    return Promise.all(
      rows.map(async (r) => {
        const collection = await ctx.db.get(r.collectionId);
        return {
          collectionId: r.collectionId,
          collectionName: collection?.name ?? 'Unknown',
          cardsAdded: r.cardsAdded,
          cardsLearned: r.cardsLearned ?? 0,
          totalTexts: collection?.textCount ?? 0,
        };
      }),
    );
  },
});

/** Card distribution across FSRS states (O(log n) via aggregates). */
export const getCardMaturityDistribution = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return null;

    const result: Record<string, number> = {};
    for (const label of STATE_LABELS) {
      result[label] = await cardsByState.count(ctx, {
        namespace: deck._id,
        bounds: { eq: label },
      });
    }
    return result;
  },
});

/** Number of cards currently due for review (O(log n) via aggregates). */
export const getDueCardCount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return 0;
    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return 0;

    return cardsByDueDate.count(ctx, {
      namespace: deck._id,
      bounds: {
        upper: { key: Date.now(), inclusive: true },
      },
    });
  },
});

/** Due card counts by state for the active deck (O(log n) via aggregates). */
export const getCardCounts = query({
  args: {},
  returns: v.union(
    v.object({
      new: v.number(),
      learning: v.number(),
      review: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return null;

    const now = Date.now();
    const dueBounds = { upper: { key: now, inclusive: true } };

    const [newCount, learningCount, reviewCount, relearningCount] = await Promise.all([
      cardsByStateAndDueDate.count(ctx, { namespace: `${deck._id}:new`, bounds: dueBounds }),
      cardsByStateAndDueDate.count(ctx, { namespace: `${deck._id}:learning`, bounds: dueBounds }),
      cardsByStateAndDueDate.count(ctx, { namespace: `${deck._id}:review`, bounds: dueBounds }),
      cardsByStateAndDueDate.count(ctx, { namespace: `${deck._id}:relearning`, bounds: dueBounds }),
    ]);

    return {
      new: newCount,
      learning: learningCount + relearningCount,
      review: reviewCount,
    };
  },
});

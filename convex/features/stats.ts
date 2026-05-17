import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { query, internalQuery } from '../_generated/server';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import { cardsByState, cardsByDueDate, cardsByStateAndDueDate } from '../db/stats/cardAggregates';
import {
  getCourseStats as dbGetCourseStats,
  getTodayInTimezone,
} from '../db/courseStats';
import { getDailyStats } from '../db/stats/dailyStats';
import { EXTENDED_STATE_LABELS as STATE_LABELS } from '../lib/fsrsStates';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import { normalizeLanguageCode } from '../../lib/languages';

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
    const targetSet = new Set(targetLanguages.map((l) => normalizeLanguageCode(l)));
    const wordsByLang = new Map<string, number>();
    for (const r of langStatsRows) {
      if (r.totalWords <= 0) continue;
      const key = normalizeLanguageCode(r.language);
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

// ----- Helpers shared by recent-words + word-search queries -----------------

/** Resolve all stored language variants (e.g. "es" + "es_latam") for a given
 * user-facing language code, looking at the active course's targetLanguages. */
function resolveLanguageVariants(
  targetLanguages: readonly string[],
  language: string,
): Set<string> {
  const normalized = normalizeLanguageCode(language);
  const variants = new Set<string>([language, normalized]);
  for (const tl of targetLanguages) {
    if (normalizeLanguageCode(tl) === normalized) variants.add(tl);
  }
  return variants;
}

/** True if `language` matches any of `targetLanguages` after normalization.
 * Used to reject client-supplied languages that don't belong to the active
 * course before we pass them to tokenization or variant resolution. */
function isTargetLanguage(
  targetLanguages: readonly string[],
  language: string,
): boolean {
  const norm = normalizeLanguageCode(language);
  return targetLanguages.some((tl) => normalizeLanguageCode(tl) === norm);
}

function normalizeSearchTerm(raw: string): string {
  return raw.slice(0, 100).trim().toLowerCase().normalize('NFC');
}

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

    const courseId = active.course._id;
    const targetLanguages = active.course.targetLanguages ?? [];
    // Dedupe variants (e.g. es + es_latam → es)
    const seen = new Set<string>();
    const langPairs: Array<{ normalized: string; raw: string }> = [];
    for (const lang of targetLanguages) {
      const norm = normalizeLanguageCode(lang);
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
          .withIndex('by_userId_and_courseId_and_language', (q) =>
            q.eq('userId', userId).eq('courseId', courseId).eq('language', variant),
          )
          .order('desc')
          .take(500);
        allWords.push(...rows.map((r) => r.displayWord ?? r.word));
      }

      if (allWords.length > 0) {
        result.push({ language: normalized, words: allWords.slice(0, 500) });
      }
    }

    return result;
  },
});

/**
 * Query 3b: Recent words for a single language (up to 1000), for the expanded word view.
 */
export const getRecentWordsForLanguage = query({
  args: {
    language: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { language, limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    const targetLanguages = active.course.targetLanguages ?? [];
    if (!isTargetLanguage(targetLanguages, language)) return [];

    const cap = Math.min(Math.max(limit ?? 1000, 1), 10000);
    const courseId = active.course._id;
    const variantSet = resolveLanguageVariants(targetLanguages, language);

    // Dedup across variants: the same normalized word can appear in both
    // `es` and `es_latam`. Keep first occurrence per normalized key so
    // descending order is preserved and result size isn't inflated.
    const allWords: string[] = [];
    const seen = new Set<string>();
    for (const variant of variantSet) {
      const rows = await ctx.db
        .query('userWords')
        .withIndex('by_userId_and_courseId_and_language', (q) =>
          q.eq('userId', userId).eq('courseId', courseId).eq('language', variant),
        )
        .order('desc')
        .take(cap);
      for (const r of rows) {
        if (seen.has(r.word)) continue;
        seen.add(r.word);
        allWords.push(r.displayWord ?? r.word);
      }
    }

    return allWords.slice(0, cap);
  },
});

/**
 * Query 3c: Full-text search for learned words within a single language.
 * Used by the expanded word popup so users can find any word in that language,
 * not just the ones currently loaded on the client.
 */
export const searchWordsForLanguage = query({
  args: {
    language: v.string(),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    const courseId = active.course._id;
    const targetLanguages = active.course.targetLanguages ?? [];
    if (!isTargetLanguage(targetLanguages, args.language)) return [];

    const term = normalizeSearchTerm(args.searchQuery);
    if (term.length === 0) return [];

    const variantSet = resolveLanguageVariants(targetLanguages, args.language);

    const perVariantResults = await Promise.all(
      Array.from(variantSet).map((variant) =>
        ctx.db
          .query('userWords')
          .withSearchIndex('search_word', (q) =>
            q
              .search('word', term)
              .eq('userId', userId)
              .eq('courseId', courseId)
              .eq('language', variant),
          )
          .take(50),
      ),
    );

    const seen = new Set<string>();
    const results: string[] = [];
    for (const rows of perVariantResults) {
      for (const row of rows) {
        if (seen.has(row.word)) continue;
        seen.add(row.word);
        results.push(row.displayWord ?? row.word);
        if (results.length >= 50) break;
      }
      if (results.length >= 50) break;
    }
    return results;
  },
});

/**
 * Query 4: Search learned words across all languages via full-text search.
 */
export const searchWords = query({
  args: {
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];

    const courseId = active.course._id;
    const term = normalizeSearchTerm(args.searchQuery);
    if (term.length === 0) return [];

    const rows = await ctx.db
      .query('userWords')
      .withSearchIndex('search_word', (q) =>
        q.search('word', term).eq('userId', userId).eq('courseId', courseId),
      )
      .take(50);

    // Deduplicate language variants (es_latam → es)
    const seen = new Set<string>();
    const results: Array<{
      word: string;
      displayWord: string;
      language: string;
    }> = [];

    for (const row of rows) {
      const lang = normalizeLanguageCode(row.language);
      const key = `${lang}:${row.word}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        word: row.word,
        displayWord: row.displayWord ?? row.word,
        language: lang,
      });
    }

    return results;
  },
});

/**
 * Query 5: Paginated sentences containing a specific word.
 * Powers the word cloud → sentence dialog.
 */
export const getSentencesForWord = query({
  args: {
    word: v.string(),
    language: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { page: [], isDone: true, continueCursor: '' };
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { page: [], isDone: true, continueCursor: '' };

    const courseId = active.course._id;
    const baseLanguages = active.course.baseLanguages ?? [];
    const targetLanguages = active.course.targetLanguages ?? [];
    if (!isTargetLanguage(targetLanguages, args.language)) {
      return { page: [], isDone: true, continueCursor: '' };
    }
    const deck = await getDeckByCourseId(ctx, courseId);

    // The frontend passes a normalized language (e.g. "es"), but userWordTexts
    // stores the raw code from the course (e.g. "es_latam"). Resolve it from
    // the course's targetLanguages — no extra DB query needed.
    const allLangs = [...baseLanguages, ...targetLanguages];
    const lang = allLangs.find(
      (l) => l === args.language || normalizeLanguageCode(l) === args.language,
    ) ?? args.language;

    const result = await ctx.db
      .query('userWordTexts')
      .withIndex('by_userId_courseId_language_word', (q) =>
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .eq('language', lang)
          .eq('word', args.word),
      )
      .order('desc')
      .paginate(args.paginationOpts);

    // Fetch text docs and card docs for each link
    const [textDocs, cardDocs] = await Promise.all([
      Promise.all(result.page.map((link) => ctx.db.get(link.textId))),
      Promise.all(
        result.page.map((link) =>
          deck ? getCardByDeckAndText(ctx, deck._id, link.textId) : null,
        ),
      ),
    ]);

    // Build inputs for the batch content loader (translations + audio for all course languages)
    const inputs = result.page
      .map((link, i) => {
        const text = textDocs[i];
        if (!text) return null;
        return {
          key: link.textId as string,
          textId: link.textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceRomanization: text.romanizedText ?? undefined,
          card: cardDocs[i] ?? null,
        };
      })
      .filter((input): input is NonNullable<typeof input> => input !== null);

    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      baseLanguages,
      targetLanguages,
    );

    const sentences = inputs.map((input) => {
      const content = contentMap.get(input.key)!;
      return {
        textId: input.textId,
        translations: content.translations,
        audioRecordings: content.audioRecordings,
        hasMissingContent: content.hasMissingContent,
        cardId: input.card?._id ?? null,
        isMastered: input.card?.isMastered ?? false,
        isHidden: input.card?.isHidden ?? false,
        isFavorite: input.card?.isFavorite ?? false,
        reviewCount: input.card
          ? input.card.preReviewCount + (input.card.fsrsState?.reps ?? 0)
          : 0,
      };
    });

    return {
      page: sentences,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
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
      relearning: v.number(),
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
      learning: learningCount,
      relearning: relearningCount,
      review: reviewCount,
    };
  },
});

// `Intl.DateTimeFormat` construction is non-trivial (~100 µs); cache one
// instance per timezone for the celebration query, which runs on a hot path
// during the milestone burst.
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dateFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone });
    dateFormatterCache.set(timeZone, f);
  }
  return f;
}

/**
 * Returns the actual word lists for the celebration screen, partitioned into
 * "this session" (highlighted) and "earlier today" (subdued). Words are
 * filtered to the active course's target languages — base languages are the
 * user's known languages, so they aren't celebrated as new vocabulary.
 *
 * Deduplication: a word is identified by (language, normalized form). If the
 * same word appears multiple times across rows, only the first occurrence is
 * kept. If it appears in both the current session and earlier today, the
 * session bucket wins — earlier-today only ever shows words the session does
 * not also contain.
 *
 * Bounded scan: we walk the most-recent userWords for the active course in
 * descending creation-time order, capped at 500 rows. That covers a day's
 * worth of new words at any realistic study pace; older rows are skipped
 * since they can't belong to today regardless of timezone.
 */
export const getNewWordsForCelebration = query({
  args: { sessionId: v.string(), timezone: v.string() },
  returns: v.object({
    session: v.array(v.object({ language: v.string(), display: v.string() })),
    today: v.array(v.object({ language: v.string(), display: v.string() })),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { session: [], today: [] };
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { session: [], today: [] };
    const targetLanguages = new Set(active.course.targetLanguages);
    const todayStr = getTodayInTimezone(args.timezone);

    // userWords' only userId+courseId-scoped indexes also key on language, so
    // iterate the target languages explicitly. Each per-language scan is
    // bounded — far more than enough to cover a single day at any realistic
    // pace, with rows older than today being skipped in the dedup loop below.
    const PER_LANG_CAP = 250;
    const perLangRows = await Promise.all(
      [...targetLanguages].map((lang) =>
        ctx.db
          .query('userWords')
          .withIndex('by_userId_and_courseId_and_language', (q) =>
            q
              .eq('userId', userId)
              .eq('courseId', active.course._id)
              .eq('language', lang),
          )
          .order('desc')
          .take(PER_LANG_CAP),
      ),
    );
    const rows = perLangRows.flat();

    const dtf = getDateFormatter(args.timezone);

    type Entry = { language: string; display: string; bucket: 'session' | 'today' };
    const seen = new Map<string, Entry>();
    for (const row of rows) {
      if (!targetLanguages.has(row.language)) continue;
      // Drop anything not from "today" in the user's timezone. Rows are in
      // desc creation order, but we don't break early — DST edge-cases mean a
      // few stragglers can sit between today and yesterday in row order.
      if (dtf.format(new Date(row._creationTime)) !== todayStr) continue;
      const key = `${row.language}:${row.word}`;
      const isSession = row.sessionId === args.sessionId;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, {
          language: row.language,
          display: row.displayWord ?? row.word,
          bucket: isSession ? 'session' : 'today',
        });
      } else if (existing.bucket === 'today' && isSession) {
        // Same word seen later as a session row — promote to session bucket.
        existing.bucket = 'session';
      }
    }

    const session: Array<{ language: string; display: string }> = [];
    const today: Array<{ language: string; display: string }> = [];
    for (const e of seen.values()) {
      const item = { language: e.language, display: e.display };
      if (e.bucket === 'session') session.push(item);
      else today.push(item);
    }
    return { session, today };
  },
});

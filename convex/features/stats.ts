import { v } from 'convex/values';
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server';
import { query, QueryCtx } from '../_generated/server';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import { TRACK_AGGREGATES } from '../db/stats/cardAggregates';
import { originsForFilter } from '../lib/collections';
import {
  studyContentFilterValidator,
  reviewModeValidator,
  translationValidator,
  audioRecordingValidator,
  type ReviewMode,
  type StudyContentFilter,
} from '../types';
import { studyContextFromSettings, type StudyContext } from '../db/reviewLogs';
import {
  getCourseStats as dbGetCourseStats,
  deriveStreakDisplay,
} from '../db/courseStats';
import { isValidTimezone, resolveClientToday } from '../lib/dateUtils';
import { addDays, startOfDayMs } from '../../lib/dateStrings';
import {
  WORKLOAD_DAYS,
  WORKLOAD_HISTORY_WINDOW_DAYS,
} from '../../lib/workloadForecast';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import type { Doc } from '../_generated/dataModel';
import { getDailyStats } from '../db/stats/dailyStats';
import { getCourseSettings } from '../db/courseSettings';
import { type FsrsStateLabel } from '../lib/fsrsStates';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import { normalizeLanguageCode } from '../../lib/languages';
import { getTargetLanguageWordCounts } from '../db/stats/languageStats';

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

// ============================================================================
// STATS PAGE QUERIES
// ============================================================================

/**
 * Query 1: small summary data (courseStats, todayStats, hourly distribution, monthly stats).
 * Loads fast, powers the numbers row, app usage, hourly chart, and line chart (year view).
 */
export const getStatsPageData = query({
  args: {
    timezone: v.string(),
    // Client-supplied "today" per the no-wall-clock query guideline (same
    // contract as getCourseStats: validated and clamped to ±1 day of the
    // server's view in resolveClientToday). Optional for back-compat:
    // already-shipped bundles omit it and keep the server-clock behavior.
    today: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    startMonth: v.string(),
    endMonth: v.string(),
    startWeek: v.optional(v.string()),
    endWeek: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      courseStats: v.union(
        v.object({
          totalRepetitions: v.number(),
          totalTimeMs: v.number(),
          totalCards: v.number(),
          currentStreak: v.number(),
          streakState: v.union(
            v.literal('active'),
            v.literal('pending'),
            v.literal('frozen'),
            v.literal('broken'),
            v.literal('none'),
          ),
          totalWordCount: v.number(),
          totalChatMessages: v.number(),
          totalChatCardsApproved: v.number(),
          totalCardsAddedManually: v.number(),
          totalAccuracySum: v.number(),
          totalAccuracyCount: v.number(),
          totalAccuracyStrictSum: v.number(),
          totalAccuracyLenientSum: v.number(),
          totalAccuracyDualCount: v.number(),
        }),
        v.null(),
      ),
      ignorePunctuation: v.boolean(),
      todayReps: v.number(),
      todayNewCards: v.number(),
      todayTimeMs: v.number(),
      hourlyDistribution: v.array(v.number()),
      monthlyStats: v.array(
        v.object({
          month: v.string(),
          totalRepetitions: v.number(),
          totalNewCards: v.number(),
          totalTimeMs: v.number(),
        }),
      ),
      weeklyStats: v.array(
        v.object({
          week: v.string(),
          totalRepetitions: v.number(),
          totalNewCards: v.number(),
          totalTimeMs: v.number(),
        }),
      ),
      baseLanguages: v.array(v.string()),
      targetLanguages: v.array(v.string()),
      languageWordCounts: v.array(
        v.object({ language: v.string(), words: v.number() }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;

    const courseId = active.course._id;
    const baseLanguages = active.course.baseLanguages ?? [];

    // courseStats
    const stats = await dbGetCourseStats(ctx, userId, courseId);
    const courseSettings = await getCourseSettings(ctx, courseId);

    // todayStats
    const todayStr = resolveClientToday(args.timezone, args.today);
    const todayDaily = await getDailyStats(ctx, userId, courseId, todayStr);

    // hourly distribution (aggregate from dailyStats)
    const hourlyTotals = Array.from({ length: 24 }, () => 0);
    if (isValidDateString(args.startDate) && isValidDateString(args.endDate)) {
      const dailyRows = await ctx.db
        .query('dailyStats')
        .withIndex('by_userId_and_courseId_and_date', (q) =>
          q
            .eq('userId', userId)
            .eq('courseId', courseId)
            .gte('date', args.startDate)
            .lte('date', args.endDate),
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
    if (
      isValidMonthString(args.startMonth) &&
      isValidMonthString(args.endMonth)
    ) {
      const rows = await ctx.db
        .query('monthlyStats')
        .withIndex('by_userId_and_courseId_and_month', (q) =>
          q
            .eq('userId', userId)
            .eq('courseId', courseId)
            .gte('month', args.startMonth)
            .lte('month', args.endMonth),
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
    if (
      args.startWeek &&
      args.endWeek &&
      isValidWeekString(args.startWeek) &&
      isValidWeekString(args.endWeek)
    ) {
      const weekRows = await ctx.db
        .query('weeklyStats')
        .withIndex('by_userId_and_courseId_and_week', (q) =>
          q
            .eq('userId', userId)
            .eq('courseId', courseId)
            .gte('week', args.startWeek!)
            .lte('week', args.endWeek!),
        )
        .take(60);

      weeklyStats = weekRows.map((r) => ({
        week: r.week,
        totalRepetitions: r.totalRepetitions,
        totalNewCards: r.totalNewCards,
        totalTimeMs: r.totalTimeMs,
      }));
    }

    const targetLanguages = active.course.targetLanguages ?? [];
    const languageWordCounts = await getTargetLanguageWordCounts(ctx, {
      userId,
      courseId,
      targetLanguages,
    });
    const totalWordCount = languageWordCounts.reduce(
      (sum, lw) => sum + lw.words,
      0,
    );

    // Re-derive the live streak at read time (see getCourseStats) so a lapsed
    // streak shows 0 and the state matches the home card.
    const streak = stats
      ? deriveStreakDisplay(
          stats.lastActivityDate,
          todayStr,
          stats.currentStreak,
          stats.streakFreezeUsedDate,
        )
      : null;

    return {
      courseStats: stats
        ? {
            totalRepetitions: stats.totalRepetitions,
            totalTimeMs: stats.totalTimeMs,
            totalCards: stats.totalCards,
            currentStreak: streak!.displayStreak,
            streakState: streak!.state,
            totalWordCount,
            totalChatMessages: stats.totalChatMessages ?? 0,
            totalChatCardsApproved: stats.totalChatCardsApproved ?? 0,
            totalCardsAddedManually: stats.totalCardsAddedManually ?? 0,
            totalAccuracySum: stats.totalAccuracySum ?? 0,
            totalAccuracyCount: stats.totalAccuracyCount ?? 0,
            // Both punctuation variants, plus the setting that says which one to
            // show. The tile picks client-side; the legacy pair above is the
            // fallback for users whose history predates the split.
            totalAccuracyStrictSum: stats.totalAccuracyStrictSum ?? 0,
            totalAccuracyLenientSum: stats.totalAccuracyLenientSum ?? 0,
            totalAccuracyDualCount: stats.totalAccuracyDualCount ?? 0,
          }
        : null,
      ignorePunctuation: courseSettings?.ignorePunctuation ?? false,
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
 * Query 2: Heavier daily data. Heatmap entries + per-language daily stats.
 * Powers the heatmap, line chart (week/month views), and per-language words chart.
 */
export const getStatsPageDailyData = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  returns: v.object({
    heatmapData: v.array(
      v.object({
        date: v.string(),
        reps: v.number(),
        timeMs: v.number(),
        newCards: v.number(),
      }),
    ),
    languageDailyData: v.array(
      v.object({
        date: v.string(),
        language: v.string(),
        newWordsCount: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    if (
      !isValidDateString(args.startDate) ||
      !isValidDateString(args.endDate)
    ) {
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
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .gte('date', args.startDate)
          .lte('date', args.endDate),
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
        q
          .eq('userId', userId)
          .eq('courseId', courseId)
          .gte('date', args.startDate)
          .lte('date', args.endDate),
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
  returns: v.array(
    v.object({ language: v.string(), words: v.array(v.string()) }),
  ),
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
            q
              .eq('userId', userId)
              .eq('courseId', courseId)
              .eq('language', variant),
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
  returns: v.array(v.string()),
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
          q
            .eq('userId', userId)
            .eq('courseId', courseId)
            .eq('language', variant),
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
  returns: v.array(v.string()),
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
  returns: v.array(
    v.object({
      word: v.string(),
      displayWord: v.string(),
      language: v.string(),
    }),
  ),
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
  returns: paginationResultValidator(
    v.object({
      textId: v.id('texts'),
      translations: v.array(translationValidator),
      audioRecordings: v.array(audioRecordingValidator),
      hasMissingContent: v.boolean(),
      cardId: v.union(v.id('cards'), v.null()),
      isMastered: v.boolean(),
      isHidden: v.boolean(),
      isFavorite: v.boolean(),
      reviewCount: v.number(),
    }),
  ),
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
    // the course's targetLanguages, no extra DB query needed.
    const allLangs = [...baseLanguages, ...targetLanguages];
    const lang =
      allLangs.find(
        (l) =>
          l === args.language || normalizeLanguageCode(l) === args.language,
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
          sourceIpa: text.ipaText ?? undefined,
          sourceFurigana: text.furiganaText ?? undefined,
          userCreated: text.userCreated,
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

/**
 * Shared implementation for the due-count queries below: resolve the caller's
 * active deck, then count due cards per FSRS state via aggregates. `filter`
 * 'both' uses the state-only aggregate (counts everything, including legacy
 * cards without a resolved origin); 'course'/'custom' sum the per-origin
 * aggregate buckets.
 */
/**
 * Shared preamble of the due-count and workload-forecast queries: resolve
 * the caller's active course, its deck, settings, and which scheduling
 * track's aggregates serve the current queue.
 *
 * With separateModeTracking on and the course in Writing mode, the due
 * queue is the writing track. Counting from the matching aggregates keeps
 * the home pills, forecast, and celebration counts describing the queue the
 * user will actually be served. The caller may pass its
 * optimistically-updated reviewMode (same rationale as the explicit `filter`
 * args below: the counts then flip in the same frame as the
 * Shadowing↔Writing toggle instead of lagging the settings round-trip);
 * separateModeTracking itself is server-owned and always read from
 * settings. `face` comes from the same resolution so the preparingWriting
 * gates can tell Free Study apart from the due queue.
 */
async function resolveDueCountContext(
  ctx: QueryCtx,
  reviewModeOverride?: ReviewMode,
): Promise<{
  userId: string;
  course: Doc<'courses'>;
  deck: Doc<'decks'>;
  settings: Doc<'courseSettings'> | null;
  face: StudyContext['face'];
  track: StudyContext['track'];
} | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const active = await getActiveCourseForUser(ctx, userId);
  if (!active) return null;
  const deck = await getDeckByCourseId(ctx, active.course._id);
  if (!deck) return null;
  const settings = await getCourseSettings(ctx, active.course._id);
  const { face, track } = studyContextFromSettings(
    settings,
    reviewModeOverride,
  );
  return { userId, course: active.course, deck, settings, face, track };
}

async function countDueCardsByState(
  ctx: QueryCtx,
  filter: StudyContentFilter,
  now: number,
  reviewModeOverride?: ReviewMode,
): Promise<{
  new: number;
  learning: number;
  relearning: number;
  review: number;
  preparingWriting?: boolean;
} | null> {
  const context = await resolveDueCountContext(ctx, reviewModeOverride);
  if (!context) return null;
  const { deck, settings, face, track } = context;
  const { state: stateAggregate, originState: originStateAggregate } =
    TRACK_AGGREGATES[track];

  const dueBounds = { upper: { key: now, inclusive: true } };

  const countState = async (state: string): Promise<number> => {
    if (filter === 'both') {
      return stateAggregate.count(ctx, {
        namespace: `${deck._id}:${state}`,
        bounds: dueBounds,
      });
    }
    const origins = originsForFilter(filter);
    const counts = await Promise.all(
      origins.map((origin) =>
        originStateAggregate.count(ctx, {
          namespace: `${deck._id}:${origin}:${state}`,
          bounds: dueBounds,
        }),
      ),
    );
    return counts.reduce((a, b) => a + b, 0);
  };

  const [newCount, learningCount, reviewCount, relearningCount] =
    await Promise.all([
      countState('new'),
      countState('learning'),
      countState('review'),
      countState('relearning'),
    ]);

  return {
    new: newCount,
    learning: learningCount,
    relearning: relearningCount,
    review: reviewCount,
    // The writing aggregates are filled by the asynchronous enable-time seed,
    // so until it finishes these counts describe only the already-seeded
    // prefix. Near-zero at the start on a large deck. Flag that rather than
    // report a confident 0/0/0/0, which reads as "nothing to study" when the
    // queue is merely still being built. (getCardForReviewEmptyReason reports
    // the same state as 'preparing_writing'.)
    //
    // `face === null` is load-bearing, exactly as in that query's gate:
    // schedulingTrackFromSettings ignores schedulingMode, so Free Study
    // (radio + Writing) also resolves to track 'writing', but free play
    // serves from the rotation and never reads the writing queue, so flagging
    // its counts provisional would grey out the pills for a queue the user is
    // never served.
    ...(face === null &&
    track === 'writing' &&
    settings?.writingSeedDone !== true
      ? { preparingWriting: true }
      : {}),
  };
}

/**
 * Due card counts by state for the active deck (O(log n) via aggregates).
 *
 * `now` follows the no-wall-clock query guideline like getFilteredCardCounts
 * below (a stable, minute-quantized value keeps the query cacheable). It stays
 * OPTIONAL for back-compat: already-shipped client bundles call with `{}` and
 * keep the historical wall-clock behavior.
 */
export const getCardCounts = query({
  args: { now: v.optional(v.number()) },
  returns: v.union(
    v.object({
      new: v.number(),
      learning: v.number(),
      relearning: v.number(),
      review: v.number(),
      // Set while the separateModeTracking writing seed is still filling the
      // writing aggregates. The counts above are a partial prefix, not a
      // settled zero. See countDueCardsByState.
      preparingWriting: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return countDueCardsByState(ctx, 'both', args.now ?? Date.now());
  },
});

/**
 * Filter-aware due card counts by state for the active deck (O(log n) via
 * aggregates). Powers the homescreen due-count pills next to the content
 * filter dropdown.
 *
 * `filter` is an explicit arg (not read from courseSettings) so the client
 * can pass its optimistically-updated filter value and the counts flip in the
 * same frame as the dropdown. `now` is client-supplied per the no-wall-clock
 * query guideline (a stable, minute-quantized value also keeps the query
 * cacheable). A skewed `now` only shifts the caller's own counts. Harmless.
 *
 * Semantics mirror `fetchDueCardsWithFilter` (scheduling.ts): 'both' counts
 * everything (including legacy cards without a resolved origin), 'course'
 * counts origin 'premade', 'custom' counts origins 'custom' + 'chat'.
 */
export const getFilteredCardCounts = query({
  args: {
    filter: v.optional(studyContentFilterValidator),
    now: v.number(),
    // Optimistic client value, same contract as `filter`. See
    // countDueCardsByState. Optional for back-compat (older bundles omit it
    // and get the settings-derived track).
    reviewMode: v.optional(reviewModeValidator),
  },
  returns: v.union(
    v.object({
      new: v.number(),
      learning: v.number(),
      relearning: v.number(),
      review: v.number(),
      // Set while the separateModeTracking writing seed is still filling the
      // writing aggregates. The counts above are a partial prefix, not a
      // settled zero. See countDueCardsByState.
      preparingWriting: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return countDueCardsByState(
      ctx,
      args.filter ?? 'both',
      args.now,
      args.reviewMode,
    );
  },
});

const workloadDayStateCountsValidator = v.object({
  new: v.number(),
  learning: v.number(),
  relearning: v.number(),
  review: v.number(),
});

/** The four states the workload forecast buckets (mastered/hidden excluded,
 * matching the serving queue — same set countDueCardsByState counts).
 * FSRS_STATE_LABELS' vocabulary, reordered to match the destructure at the
 * `prefixFor` call site; `satisfies` pins every entry to the shared type. */
const WORKLOAD_STATES = [
  'new',
  'learning',
  'relearning',
  'review',
] as const satisfies readonly FsrsStateLabel[];

/**
 * Exact per-day scheduled due counts for the next WORKLOAD_DAYS days, plus a
 * trailing window of the user's own behaviour — everything the pure
 * forecast model (lib/workloadForecast.ts) needs to render the home-screen
 * workload card.
 *
 * Day buckets are prefix-count differences over the due-date-sorted
 * aggregates: per state (and per origin bucket when filtered), one count at
 * each of the 8 upper bounds [now, start(today+1) … start(today+7)]. Today
 * splits into `availableNow` (due ≤ now — overdue backlog included) and
 * `laterToday`; each `futureDays[k]` is one whole user-local day, boundaries
 * from the DST-safe `startOfDayMs`. All counts run in one Promise.all and
 * one transaction snapshot, so the diffs can't go negative (the max(0,…) is
 * belt and braces).
 *
 * Cost: 4 states × 8 bounds × (1 namespace, or 2 for filter 'custom') =
 * 32–64 O(log n) aggregate counts, +3 unbounded state counts for
 * `startedCards`, + ≤ ~20 dailyStats rows. `now` is
 * client-supplied and minute-quantized (the only wall-clock read is
 * resolveClientToday's ±1-day validation of `today`; identical
 * args keep the query cacheable across subscribers). If this query ever
 * shows up in insights, the trim ladder is: drop the `laterToday` split
 * (−4/−8 counts), then restrict `filter` support to 'both'.
 *
 * `timezone`/`today` follow the projections.ts contract: invalid zone falls
 * back to UTC, the client's `today` is accepted only within ±1 day of the
 * server's view, and `now` is clamped into today's window so a skewed
 * client clock only shifts its own display.
 */
export const getWorkloadForecast = query({
  args: {
    timezone: v.string(),
    today: v.string(),
    now: v.number(),
    // Optimistic client values, same contract as getFilteredCardCounts.
    reviewMode: v.optional(reviewModeValidator),
    filter: v.optional(studyContentFilterValidator),
  },
  returns: v.union(
    v.null(),
    v.object({
      today: v.string(),
      dayStartMs: v.number(),
      availableNow: workloadDayStateCountsValidator,
      laterToday: workloadDayStateCountsValidator,
      futureDays: v.array(workloadDayStateCountsValidator),
      history: v.object({
        windowDays: v.number(),
        activeDays: v.number(),
        reps: v.number(),
        cardsReviewed: v.number(),
        newCards: v.number(),
        timeMs: v.number(),
        reviewsByMode: v.object({ audio: v.number(), full: v.number() }),
        timeMsByMode: v.object({ audio: v.number(), full: v.number() }),
        ratingCounts: v.object({
          stillLearning: v.number(),
          understood: v.number(),
          again: v.number(),
          hard: v.number(),
          good: v.number(),
          easy: v.number(),
        }),
      }),
      initialReviewCount: v.number(),
      // Cards in any non-'new' active state across the WHOLE deck (no due
      // bound, no content filter) — the client's minimum-activity gate for
      // the forecast card. Filter-independent so toggling the content
      // filter can't flip the card in and out of existence.
      startedCards: v.number(),
      // Set while the separateModeTracking writing seed is still filling the
      // writing aggregates. See countDueCardsByState.
      preparingWriting: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    const context = await resolveDueCountContext(ctx, args.reviewMode);
    if (!context) return null;
    const { userId, course, deck, settings, face, track } = context;
    const filter = args.filter ?? 'both';

    const timezone = isValidTimezone(args.timezone) ? args.timezone : 'UTC';
    const today = resolveClientToday(timezone, args.today);
    const boundaries: number[] = [];
    for (let k = 0; k <= WORKLOAD_DAYS; k++) {
      boundaries.push(startOfDayMs(addDays(today, k), timezone));
    }
    const now = Math.min(Math.max(args.now, boundaries[0]), boundaries[1] - 1);

    const { state: stateAggregate, originState: originStateAggregate } =
      TRACK_AGGREGATES[track];
    const uppers = [
      { key: now, inclusive: true },
      ...boundaries.slice(1).map((b) => ({ key: b, inclusive: false })),
    ];

    // Cumulative counts per state at each upper bound, summed over the
    // filter's namespaces.
    const prefixFor = async (state: string): Promise<number[]> => {
      const pairs =
        filter === 'both'
          ? [{ aggregate: stateAggregate, namespace: `${deck._id}:${state}` }]
          : originsForFilter(filter).map((origin) => ({
              aggregate: originStateAggregate,
              namespace: `${deck._id}:${origin}:${state}`,
            }));
      const perPair = await Promise.all(
        pairs.map(({ aggregate, namespace }) =>
          Promise.all(
            uppers.map((upper) =>
              aggregate.count(ctx, { namespace, bounds: { upper } }),
            ),
          ),
        ),
      );
      return uppers.map((_, i) =>
        perPair.reduce((sum, counts) => sum + counts[i], 0),
      );
    };
    const [pNew, pLearning, pRelearning, pReview] = await Promise.all(
      WORKLOAD_STATES.map(prefixFor),
    );

    // Deck-wide unbounded counts (3 more O(log n) reads) rather than the
    // filtered prefix counts above: the gate asks "has this user studied at
    // all", which no due window or content filter should change.
    const startedCards = (
      await Promise.all(
        (['learning', 'relearning', 'review'] as const).map((state) =>
          stateAggregate.count(ctx, { namespace: `${deck._id}:${state}` }),
        ),
      )
    ).reduce((sum, n) => sum + n, 0);

    const bucket = (pick: (prefix: number[]) => number) => ({
      new: Math.max(0, pick(pNew)),
      learning: Math.max(0, pick(pLearning)),
      relearning: Math.max(0, pick(pRelearning)),
      review: Math.max(0, pick(pReview)),
    });
    const availableNow = bucket((p) => p[0]);
    const laterToday = bucket((p) => p[1] - p[0]);
    const futureDays = Array.from({ length: WORKLOAD_DAYS - 1 }, (_, i) =>
      bucket((p) => p[i + 2] - p[i + 1]),
    );

    // Trailing window of COMPLETE days (today excluded — a partial day would
    // bias the adds/pace averages). Bounded scan, precedent projections.ts.
    const windowRows = await ctx.db
      .query('dailyStats')
      .withIndex('by_userId_and_courseId_and_date', (q) =>
        q
          .eq('userId', userId)
          .eq('courseId', course._id)
          .gte('date', addDays(today, -WORKLOAD_HISTORY_WINDOW_DAYS))
          .lte('date', addDays(today, -1)),
      )
      .take(WORKLOAD_HISTORY_WINDOW_DAYS + 5);

    const history = {
      windowDays: WORKLOAD_HISTORY_WINDOW_DAYS,
      activeDays: 0,
      reps: 0,
      cardsReviewed: 0,
      newCards: 0,
      timeMs: 0,
      reviewsByMode: { audio: 0, full: 0 },
      timeMsByMode: { audio: 0, full: 0 },
      ratingCounts: {
        stillLearning: 0,
        understood: 0,
        again: 0,
        hard: 0,
        good: 0,
        easy: 0,
      },
    };
    for (const row of windowRows) {
      if (row.reps > 0) history.activeDays += 1;
      history.reps += row.reps;
      history.cardsReviewed += row.cardsReviewed;
      history.newCards += row.newCards;
      history.timeMs += row.timeMs;
      // Graded modes only — free play's radio/freeStudy members say nothing
      // about per-review pace.
      history.reviewsByMode.audio += row.reviewsByMode?.audio ?? 0;
      history.reviewsByMode.full += row.reviewsByMode?.full ?? 0;
      history.timeMsByMode.audio += row.timeMsByMode?.audio ?? 0;
      history.timeMsByMode.full += row.timeMsByMode?.full ?? 0;
      if (row.ratingCounts) {
        history.ratingCounts.stillLearning += row.ratingCounts.stillLearning;
        history.ratingCounts.understood += row.ratingCounts.understood;
        history.ratingCounts.again += row.ratingCounts.again;
        history.ratingCounts.hard += row.ratingCounts.hard;
        history.ratingCounts.good += row.ratingCounts.good;
        history.ratingCounts.easy += row.ratingCounts.easy;
      }
    }

    return {
      today,
      dayStartMs: boundaries[0],
      availableNow,
      laterToday,
      futureDays,
      history,
      initialReviewCount:
        settings?.initialReviewCount ?? DEFAULT_INITIAL_REVIEW_COUNT,
      startedCards,
      // Same provisional gate as countDueCardsByState: a mid-seed writing
      // queue is a partial prefix, not a settled zero.
      ...(face === null &&
      track === 'writing' &&
      settings?.writingSeedDone !== true
        ? { preparingWriting: true }
        : {}),
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
 * filtered to the active course's target languages. Base languages are the
 * user's known languages, so they aren't celebrated as new vocabulary.
 *
 * Deduplication: a word is identified by (language, normalized form). If the
 * same word appears multiple times across rows, only the first occurrence is
 * kept. If it appears in both the current session and earlier today, the
 * session bucket wins. Earlier-today only ever shows words the session does
 * not also contain.
 *
 * Bounded scan: we walk the most-recent userWords for the active course in
 * descending creation-time order, capped at 500 rows. That covers a day's
 * worth of new words at any realistic study pace; older rows are skipped
 * since they can't belong to today regardless of timezone.
 */
export const getNewWordsForCelebration = query({
  // `today` is client-supplied per the no-wall-clock query guideline (same
  // contract as getStatsPageData above: validated and clamped to ±1 day of
  // the server's view in resolveClientToday). Optional for back-compat:
  // already-shipped bundles omit it and keep the server-clock behavior.
  args: {
    sessionId: v.string(),
    timezone: v.string(),
    today: v.optional(v.string()),
  },
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
    const todayStr = resolveClientToday(args.timezone, args.today);

    // userWords' only userId+courseId-scoped indexes also key on language, so
    // iterate the target languages explicitly. Each per-language scan is
    // bounded. Far more than enough to cover a single day at any realistic
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

    type Entry = {
      language: string;
      display: string;
      bucket: 'session' | 'today';
    };
    const seen = new Map<string, Entry>();
    for (const row of rows) {
      if (!targetLanguages.has(row.language)) continue;
      // Drop anything not from "today" in the user's timezone. Rows are in
      // desc creation order, but we don't break early. DST edge-cases mean a
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
        // Same word seen later as a session row. Promote to session bucket.
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

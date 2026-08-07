import { v } from 'convex/values';
import { query } from '../_generated/server';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser } from '../db/courses';
import { getDeckByCourseId } from '../db/decks';
import { getCourseSettings } from '../db/courseSettings';
import { getCourseStats } from '../db/courseStats';
import { getTargetLanguageWordCounts } from '../db/stats/languageStats';
import {
  getPremadeLevelCollections,
  getCollectionProgressForCourse,
} from '../db/collections';
import { isValidTimezone, resolveClientToday } from '../lib/dateUtils';
import { normalizeLanguageCode } from '../../lib/languages';
import {
  addDays,
  daysBetween,
  dateInTimezone,
} from '../../lib/dateStrings';
import {
  computeIndicators,
  PACE_WINDOW_DAYS,
  type DailyEntry,
  type LevelInfo,
} from '../../lib/projections';

/**
 * The homescreen slot stays locked until the learner has this much study time
 * on the course. A year-out extrapolation off a 20-second first session is
 * noise dressed up as a promise, and it reads as such.
 *
 * Deliberately enforced here rather than in `lib/projections.ts`: onboarding's
 * WordProjectionStep runs its first-session projection before any study time
 * exists at all, and must stay exempt.
 */
const MIN_STUDY_MS_FOR_PROJECTIONS = 10 * 60_000;

const indicatorValidator = v.union(
  v.object({
    kind: v.literal('endOfYearWords'),
    words: v.number(),
    capped: v.boolean(),
    year: v.string(),
  }),
  v.object({
    kind: v.literal('oneYearWords'),
    words: v.number(),
    capped: v.boolean(),
  }),
  v.object({
    kind: v.literal('endOfMonthWords'),
    words: v.number(),
    capped: v.boolean(),
    monthDate: v.string(),
  }),
  v.object({
    kind: v.literal('counterfactualWords'),
    boostedWords: v.number(),
    baselineWords: v.number(),
    capped: v.boolean(),
    horizonDate: v.string(),
  }),
  v.object({
    kind: v.literal('sessionYield'),
    words: v.number(),
    goalMinutes: v.number(),
  }),
  v.object({
    kind: v.literal('endOfYearSentences'),
    sentences: v.number(),
    year: v.string(),
  }),
  v.object({ kind: v.literal('sentencesPerHour'), rate: v.number() }),
  v.object({
    kind: v.literal('nextLevel'),
    currentCode: v.string(),
    nextCode: v.union(v.string(), v.null()),
    etaDays: v.number(),
    etaDate: v.string(),
  }),
  v.object({
    kind: v.literal('levelByYearEnd'),
    code: v.string(),
    year: v.string(),
  }),
  v.object({
    kind: v.literal('nextWordMilestone'),
    milestone: v.number(),
    etaDays: v.number(),
    etaDate: v.string(),
  }),
  v.object({
    kind: v.literal('studyTimeMilestone'),
    hours: v.number(),
    etaDays: v.number(),
    etaDate: v.string(),
  }),
  v.object({ kind: v.literal('empty') }),
);

/**
 * Long-term motivation projections for the homescreen's rotating slot.
 * All math lives in lib/projections.ts (shared with onboarding); this query
 * only assembles bounded inputs:
 *   - 90-day range scans of dailyStats (≤90 rows) and dailyLanguageStats
 *     (≤90 × languages rows) via by_userId_and_courseId_and_date,
 *   - all-time totals from courseStats + languageStats,
 *   - premade level progress (same reads as getHomeSummary).
 *
 * `today` is client-computed ("YYYY-MM-DD" in the user's timezone) per the
 * no-wall-clock-in-queries guideline; it is validated and clamped against
 * the server's view of that timezone (±1 day) so a skewed client clock
 * can't poison projections.
 */
export const getProjections = query({
  args: { timezone: v.string(), today: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      today: v.string(),
      basis: v.union(
        v.literal('observed'),
        v.literal('firstSession'),
        v.literal('goal'),
        v.literal('empty'),
      ),
      currentWords: v.number(),
      indicators: v.array(indicatorValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return null;
    const { course } = active;

    // Guard the raw browser value: an empty/unknown zone would make every
    // Intl.DateTimeFormat below throw and error the whole projection slot.
    const timezone = isValidTimezone(args.timezone) ? args.timezone : 'UTC';

    // Well-formed, canonicalized and clamped to ±1 day of the server's view of
    // the zone. Canonicalization matters here beyond the clamp: `today` is used
    // below as an index bound and as a `wordsByDate` map key, and a
    // non-canonical-but-plausible value like "2026-08-00" would pass a bare
    // regex, survive the clamp (it resolves to Jul 31), then miss the map and
    // push `endOfMonth` a month out.
    const today = resolveClientToday(timezone, args.today);

    const startDate = addDays(today, -(PACE_WINDOW_DAYS - 1));

    const [dailyRows, dailyLangRows, wordCounts, courseStats, settings, deck] =
      await Promise.all([
        ctx.db
          .query('dailyStats')
          .withIndex('by_userId_and_courseId_and_date', (q) =>
            q
              .eq('userId', userId)
              .eq('courseId', course._id)
              .gte('date', startDate)
              .lte('date', today),
          )
          .take(PACE_WINDOW_DAYS + 5),
        // Descending so that if the window holds more rows than the cap
        // (≥7 tracked languages × 90 days), truncation drops the OLDEST
        // days — the decayed pace weights the newest days most, and an
        // ascending read would silently cut exactly those.
        ctx.db
          .query('dailyLanguageStats')
          .withIndex('by_userId_and_courseId_and_date', (q) =>
            q
              .eq('userId', userId)
              .eq('courseId', course._id)
              .gte('date', startDate)
              .lte('date', today),
          )
          .order('desc')
          .take(600),
        getTargetLanguageWordCounts(ctx, {
          userId,
          courseId: course._id,
          targetLanguages: course.targetLanguages,
        }),
        getCourseStats(ctx, userId, course._id),
        getCourseSettings(ctx, course._id),
        getDeckByCourseId(ctx, course._id),
      ]);

    const currentWords = wordCounts.reduce((acc, w) => acc + w.words, 0);
    const totalTimeMs = courseStats?.totalTimeMs ?? 0;

    // Below the unlock threshold there is nothing worth projecting — bail out
    // before the level-collection reads and let the client show its teaser.
    if (totalTimeMs < MIN_STUDY_MS_FOR_PROJECTIONS) {
      return {
        today,
        basis: 'empty' as const,
        currentWords,
        indicators: [{ kind: 'empty' as const }],
      };
    }

    // Per-day new words, target languages only (variants merged — same
    // normalization as the words-known total).
    const targetSet = new Set(
      course.targetLanguages.map((l) => normalizeLanguageCode(l)),
    );
    const wordsByDate = new Map<string, number>();
    for (const row of dailyLangRows) {
      if (!targetSet.has(normalizeLanguageCode(row.language))) continue;
      wordsByDate.set(
        row.date,
        (wordsByDate.get(row.date) ?? 0) + row.newWordsCount,
      );
    }
    const dailyWords: DailyEntry[] = Array.from(wordsByDate, ([date, value]) => ({
      date,
      value,
    }));
    const dailyNewCards: DailyEntry[] = dailyRows.map((r) => ({
      date: r.date,
      value: r.newCards,
    }));
    const dailyMinutes: DailyEntry[] = dailyRows.map((r) => ({
      date: r.date,
      value: r.timeMs / 60_000,
    }));

    // Premade levels + progress → LevelInfo[], active index via settings.
    const [{ collections: levelCollections }, progressRows] = await Promise.all(
      [
        getPremadeLevelCollections(ctx),
        getCollectionProgressForCourse(ctx, userId, course._id),
      ],
    );
    const progressByCollection = new Map(
      progressRows.map((r) => [r.collectionId, r]),
    );
    const levels: LevelInfo[] = levelCollections.map((c) => {
      const progress = progressByCollection.get(c._id);
      const carry = progress?.legacyCarryAdded ?? 0;
      return {
        // Difficulty label ("A1.2"), not the internal dataset code ("L02") —
        // matches the level rail's chips.
        code: c.displayName ?? c.code ?? c.name,
        totalTexts: c.textCount + carry,
        cardsAdded: progress?.cardsAdded ?? 0,
        ignoredCount: progress?.ignoredCount ?? 0,
      };
    });
    const activeLevelIndex = settings?.activeCollectionId
      ? levelCollections.findIndex((c) => c._id === settings.activeCollectionId)
      : -1;

    const creationDate = dateInTimezone(course._creationTime, timezone);
    const courseAgeDays = Math.max(1, daysBetween(creationDate, today) + 1);

    const result = computeIndicators({
      today,
      courseAgeDays,
      goalMinutes: settings?.dailyTimeGoalMinutes ?? null,
      currentWords,
      currentSentences: courseStats?.totalCards ?? deck?.cardCount ?? 0,
      totalTimeMs,
      todayWords: wordsByDate.get(today) ?? 0,
      dailyWords,
      dailyNewCards,
      dailyMinutes,
      levels: levels.length > 0 ? levels : null,
      activeLevelIndex,
    });

    return {
      today,
      basis: result.basis,
      currentWords,
      indicators: result.indicators,
    };
  },
});

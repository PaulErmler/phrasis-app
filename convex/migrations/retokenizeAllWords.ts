import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { trackNewWords } from '../db/stats/wordTracking';
import { upsertDailyLanguageStats } from '../db/stats/dailyLanguageStats';

const BATCH_SIZE = 50;
const DELETE_BATCH_SIZE = 200;

/**
 * Rebuild all word tracking using the current tokenizer rules.
 *
 * Ships alongside the Intl.Segmenter unification in wordTracking.ts.
 * Old rows keyed on regex-era tokens (e.g. `l'homme` kept whole,
 * `mother-in-law` kept whole) are wiped and recomputed from the
 * source texts of reviewed cards.
 *
 * Idempotent — safe to re-run. Same three-phase structure as
 * backfillUserStats, but also wipes userWordTexts before reprocessing
 * so stale junction rows don't orphan when normalized tokens change.
 */
const COURSES_PER_PAGE = 100;

export const run = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Phase 1: paginate all courses, zero their stats, and accumulate each
    // user's full course list into `retokenizeMigrationState`. We do NOT
    // schedule any per-user clear/process chains here, because a user whose
    // courses span multiple pages would otherwise get their freshly-rebuilt
    // rows wiped by a later page's `clearUserWords` (which scopes only on
    // userId). When pagination finishes, Phase 2 (`startPerUserChains`)
    // dispatches one chain per user with the complete course list.
    const result = await ctx.db.query('courses').paginate({
      cursor: args.cursor ?? null,
      numItems: COURSES_PER_PAGE,
    });
    const courses = result.page;

    for (const course of courses) {
      const stats = await ctx.db
        .query('courseStats')
        .withIndex('by_userId_and_courseId', (q) =>
          q.eq('userId', course.userId).eq('courseId', course._id),
        )
        .first();
      if (stats && (stats.totalWordCount ?? 0) > 0) {
        await ctx.db.patch(stats._id, { totalWordCount: 0 });
      }
    }

    for (const course of courses) {
      const langRows = await ctx.db
        .query('languageStats')
        .withIndex('by_userId_and_courseId', (q) =>
          q.eq('userId', course.userId).eq('courseId', course._id),
        )
        .take(50);
      for (const row of langRows) {
        if (row.totalWords > 0) {
          await ctx.db.patch(row._id, { totalWords: 0 });
        }
      }
    }

    for (const course of courses) {
      const dailyLangRows = await ctx.db
        .query('dailyLanguageStats')
        .withIndex('by_userId_and_courseId_and_date', (q) =>
          q.eq('userId', course.userId).eq('courseId', course._id),
        )
        .take(2000);
      for (const row of dailyLangRows) {
        if (row.newWordsCount > 0) {
          await ctx.db.patch(row._id, { newWordsCount: 0 });
        }
      }
    }

    // Group this page's courses by userId so we patch each state row once.
    const userCourses = new Map<string, Array<typeof courses[number]>>();
    for (const course of courses) {
      const list = userCourses.get(course.userId) ?? [];
      list.push(course);
      userCourses.set(course.userId, list);
    }

    for (const [userId, userCourseList] of userCourses) {
      const state = await ctx.db
        .query('retokenizeMigrationState')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .first();
      const pageIds = userCourseList.map((c) => c._id);
      if (state) {
        const seen = new Set(state.courseIds);
        const merged = state.courseIds.slice();
        for (const id of pageIds) if (!seen.has(id)) merged.push(id);
        if (merged.length !== state.courseIds.length) {
          await ctx.db.patch(state._id, { courseIds: merged });
        }
      } else {
        await ctx.db.insert('retokenizeMigrationState', {
          userId,
          courseIds: pageIds,
        });
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.run,
        { cursor: result.continueCursor },
      );
      return {
        status: 'in_progress',
        coursesFound: courses.length,
      };
    }

    // Phase 1 complete — dispatch Phase 2.
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.retokenizeAllWords.startPerUserChains,
      {},
    );
    return {
      status: 'phase1_done',
      coursesFound: courses.length,
    };
  },
});

/**
 * Phase 2 dispatcher. Paginates `retokenizeMigrationState` and schedules one
 * `clearUserWords` chain per user with that user's *full* course list. Each
 * state row is deleted after scheduling so re-running `run` is idempotent.
 */
export const startPerUserChains = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const STATE_PER_PAGE = 100;
    const result = await ctx.db
      .query('retokenizeMigrationState')
      .paginate({
        cursor: args.cursor ?? null,
        numItems: STATE_PER_PAGE,
      });

    let usersQueued = 0;
    for (const row of result.page) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.clearUserWords,
        {
          userId: row.userId,
          courseIds: row.courseIds,
        },
      );
      await ctx.db.delete(row._id);
      usersQueued++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.startPerUserChains,
        { cursor: result.continueCursor },
      );
    }

    return {
      status: result.isDone ? 'done' : 'in_progress',
      usersQueued,
    };
  },
});

/**
 * Paginated delete of userWords for a single user.
 * When done, chains into clearUserWordTexts.
 */
export const clearUserWords = internalMutation({
  args: {
    userId: v.string(),
    courseIds: v.array(v.id('courses')),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('userWords')
      .withIndex('by_userId_and_courseId_and_language_and_word', (q) =>
        q.eq('userId', args.userId),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: DELETE_BATCH_SIZE,
      });

    for (const row of result.page) {
      await ctx.db.delete(row._id);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.clearUserWords,
        {
          userId: args.userId,
          courseIds: args.courseIds,
          cursor: result.continueCursor,
        },
      );
      return { status: 'clearing_words', deleted: result.page.length };
    }

    await ctx.scheduler.runAfter(
      0,
      internal.migrations.retokenizeAllWords.clearUserWordTexts,
      {
        userId: args.userId,
        courseIds: args.courseIds,
      },
    );
    return { status: 'words_cleared' };
  },
});

/**
 * Paginated delete of userWordTexts for a single user across all their
 * courses. When done, schedules processCourseBatch per course.
 */
export const clearUserWordTexts = internalMutation({
  args: {
    userId: v.string(),
    courseIds: v.array(v.id('courses')),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('userWordTexts')
      .withIndex('by_userId_courseId_language_word', (q) =>
        q.eq('userId', args.userId),
      )
      .paginate({
        cursor: args.cursor ?? null,
        numItems: DELETE_BATCH_SIZE,
      });

    for (const row of result.page) {
      await ctx.db.delete(row._id);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.clearUserWordTexts,
        {
          userId: args.userId,
          courseIds: args.courseIds,
          cursor: result.continueCursor,
        },
      );
      return { status: 'clearing_texts', deleted: result.page.length };
    }

    for (const courseId of args.courseIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.processCourseBatch,
        { courseId, userId: args.userId },
      );
    }

    return { status: 'cleared', coursesQueued: args.courseIds.length };
  },
});

/**
 * Process one course: iterate its reviewed cards, re-tokenize with the
 * new rules, and rebuild userWords + userWordTexts + language stats.
 */
export const processCourseBatch = internalMutation({
  args: {
    courseId: v.id('courses'),
    userId: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId);
    if (!course) return { status: 'course_not_found' };

    const deck = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', args.courseId))
      .first();
    if (!deck) return { status: 'no_deck' };

    const result = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .paginate({
        cursor: args.cursor ?? null,
        numItems: BATCH_SIZE,
      });

    const allLanguages = [...new Set([...course.baseLanguages, ...course.targetLanguages])];
    let totalNewWords = 0;

    for (const card of result.page) {
      if (!card.lastReviewedAt) continue;

      const text = await ctx.db.get(card.textId);
      if (!text) continue;

      const langTexts: Array<{ language: string; text: string }> = [
        { language: text.language, text: text.text },
      ];
      for (const lang of allLanguages) {
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

      const newWordCounts = await trackNewWords(ctx, {
        userId: args.userId,
        courseId: args.courseId,
        languages: langTexts,
        textId: card.textId,
      });

      await ctx.db.patch(card._id, { wordsTrackedLanguages: allLanguages });

      const reviewDate = new Date(card.lastReviewedAt);
      const dateStr = `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}-${String(reviewDate.getDate()).padStart(2, '0')}`;

      for (const [lang, count] of Object.entries(newWordCounts)) {
        totalNewWords += count;
        if (count > 0) {
          const existing = await ctx.db
            .query('languageStats')
            .withIndex('by_userId_and_courseId_and_language', (q) =>
              q.eq('userId', args.userId).eq('courseId', args.courseId).eq('language', lang),
            )
            .first();
          if (existing) {
            await ctx.db.patch(existing._id, {
              totalWords: existing.totalWords + count,
            });
          } else {
            await ctx.db.insert('languageStats', {
              userId: args.userId,
              courseId: args.courseId,
              language: lang,
              totalRepetitions: 0,
              totalNewCards: 0,
              totalTimeMs: 0,
              totalWords: count,
            });
          }

          await upsertDailyLanguageStats(ctx, {
            userId: args.userId,
            courseId: args.courseId,
            date: dateStr,
            language: lang,
            timeMs: 0,
            isNewCard: false,
            newWordsCount: count,
          });
        }
      }
    }

    if (totalNewWords > 0) {
      const stats = await ctx.db
        .query('courseStats')
        .withIndex('by_userId_and_courseId', (q) =>
          q.eq('userId', args.userId).eq('courseId', args.courseId),
        )
        .first();
      if (stats) {
        await ctx.db.patch(stats._id, {
          totalWordCount: (stats.totalWordCount ?? 0) + totalNewWords,
        });
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.retokenizeAllWords.processCourseBatch,
        {
          courseId: args.courseId,
          userId: args.userId,
          cursor: result.continueCursor,
        },
      );
    }

    return {
      processed: result.page.length,
      newWords: totalNewWords,
      isDone: result.isDone,
    };
  },
});

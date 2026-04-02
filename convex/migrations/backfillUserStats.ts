import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { trackNewWords } from '../db/stats/wordTracking';
import { upsertDailyLanguageStats } from '../db/stats/dailyLanguageStats';

const BATCH_SIZE = 50;
const DELETE_BATCH_SIZE = 200;

/**
 * Entry point: run from dashboard with no parameters.
 * Idempotent — resets all word-related stats before rebuilding them,
 * so it can safely be run multiple times.
 *
 * Phase 1: Reset courseStats.totalWordCount and languageStats.totalWords,
 *          then clear userWords per user before reprocessing.
 * Phase 2: Re-scan reviewed cards and rebuild word counts.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const courses = await ctx.db.query('courses').take(500);

    // Reset courseStats.totalWordCount to 0 for every course
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

    // Reset languageStats.totalWords to 0 for every course
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

    // Reset dailyLanguageStats.newWordsCount to 0 for every course
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

    // Collect unique userIds, then schedule userWords cleanup per user.
    // Each cleanup chains into processCourseBatch for that user's courses.
    const userCourses = new Map<string, typeof courses>();
    for (const course of courses) {
      const list = userCourses.get(course.userId) ?? [];
      list.push(course);
      userCourses.set(course.userId, list);
    }

    let usersQueued = 0;
    for (const [userId, userCourseList] of userCourses) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillUserStats.clearUserWords,
        {
          userId,
          courseIds: userCourseList.map((c) => c._id),
        },
      );
      usersQueued++;
    }

    return { status: 'started', coursesFound: courses.length, usersQueued };
  },
});

/**
 * Delete all userWords for a user (paginated), then schedule
 * processCourseBatch for each of their courses.
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
      .withIndex('by_userId_and_language', (q) =>
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
      // More words to delete — continue clearing before processing
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillUserStats.clearUserWords,
        {
          userId: args.userId,
          courseIds: args.courseIds,
          cursor: result.continueCursor,
        },
      );
      return { status: 'clearing', deleted: result.page.length };
    }

    // All words cleared — now schedule course processing
    for (const courseId of args.courseIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillUserStats.processCourseBatch,
        { courseId, userId: args.userId },
      );
    }

    return { status: 'cleared', coursesQueued: args.courseIds.length };
  },
});

/**
 * Process one course: iterate its reviewed cards, extract words,
 * and rebuild language stats + word tracking.
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

    // Paginate through cards that have been reviewed at least once
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
      // Only process cards that have been reviewed (have lastReviewedAt)
      if (!card.lastReviewedAt) continue;

      const text = await ctx.db.get(card.textId);
      if (!text) continue;

      // Build language->text pairs
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

      // Track new words (idempotent: skips words already in userWords)
      const newWordCounts = await trackNewWords(ctx, {
        userId: args.userId,
        languages: langTexts,
      });

      // Stamp the card so future reviews skip already-tracked languages
      await ctx.db.patch(card._id, { wordsTrackedLanguages: allLanguages });

      // Derive date from card's lastReviewedAt for daily language stats
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

          // Also populate dailyLanguageStats so the words chart has data
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

    // Update courseStats totalWordCount
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
        internal.migrations.backfillUserStats.processCourseBatch,
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

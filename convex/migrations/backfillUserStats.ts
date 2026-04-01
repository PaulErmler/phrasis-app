import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { Id } from '../_generated/dataModel';
import { trackNewWords } from '../db/stats/wordTracking';
import { upsertLanguageStats } from '../db/stats/languageStats';

const BATCH_SIZE = 50;

/**
 * Entry point: run from dashboard with no parameters.
 * Iterates all courses and backfills word counts + language stats
 * from existing reviewed cards.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Gather all courses
    const courses = await ctx.db.query('courses').take(500);
    for (const course of courses) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillUserStats.processCourseBatch,
        { courseId: course._id, userId: course.userId },
      );
    }
    return { status: 'started', coursesQueued: courses.length };
  },
});

/**
 * Process one course: iterate its reviewed cards, extract words,
 * and build language stats + word tracking.
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

      // Track new words (insertIfDoesNotExist pattern in trackNewWords)
      const newWordCounts = await trackNewWords(ctx, {
        userId: args.userId,
        languages: langTexts,
      });

      for (const [lang, count] of Object.entries(newWordCounts)) {
        totalNewWords += count;
        // Ensure languageStats row exists (upsert with 0 reps since we
        // don't reconstruct daily history, just word counts)
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

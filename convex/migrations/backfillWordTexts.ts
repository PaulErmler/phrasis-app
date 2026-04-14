import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { tokenizeText } from '../db/stats/wordTracking';

const BATCH_SIZE = 20;
const MAX_TEXTS_PER_WORD = 30;

/**
 * Entry point: run from dashboard with no parameters.
 * Populates the userWordTexts junction table by scanning reviewed cards.
 * Idempotent — uses dedup checks before inserting.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const courses = await ctx.db.query('courses').take(500);

    for (const course of courses) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillWordTexts.processCourseBatch,
        { courseId: course._id, userId: course.userId },
      );
    }

    return { status: 'started', coursesQueued: courses.length };
  },
});

/**
 * Process one course: iterate reviewed cards, tokenize texts,
 * and insert userWordTexts rows linking words to their source texts.
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

    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];
    let inserted = 0;

    for (const card of result.page) {
      if (!card.lastReviewedAt) continue;

      const text = await ctx.db.get(card.textId);
      if (!text) continue;

      // Build language -> text pairs
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

      // For each language, tokenize and insert word-text links
      for (const { language, text: langText } of langTexts) {
        const tokens = tokenizeText(langText, language);
        const seen = new Set<string>();

        for (const { normalized } of tokens) {
          if (seen.has(normalized)) continue;
          seen.add(normalized);

          // Check if link already exists
          const existing = await ctx.db
            .query('userWordTexts')
            .withIndex('by_userId_courseId_language_word_textId', (q) =>
              q
                .eq('userId', args.userId)
                .eq('courseId', args.courseId)
                .eq('language', language)
                .eq('word', normalized)
                .eq('textId', card.textId),
            )
            .first();

          if (existing) continue;

          // Enforce per-word cap
          const count = await ctx.db
            .query('userWordTexts')
            .withIndex('by_userId_courseId_language_word', (q) =>
              q
                .eq('userId', args.userId)
                .eq('courseId', args.courseId)
                .eq('language', language)
                .eq('word', normalized),
            )
            .take(MAX_TEXTS_PER_WORD);

          if (count.length >= MAX_TEXTS_PER_WORD) continue;

          await ctx.db.insert('userWordTexts', {
            userId: args.userId,
            courseId: args.courseId,
            language,
            word: normalized,
            textId: card.textId,
          });
          inserted++;
        }
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillWordTexts.processCourseBatch,
        {
          courseId: args.courseId,
          userId: args.userId,
          cursor: result.continueCursor,
        },
      );
    }

    return {
      processed: result.page.length,
      inserted,
      isDone: result.isDone,
    };
  },
});

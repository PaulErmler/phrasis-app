import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { tokenizeText, isAllLowercase } from '../db/stats/wordTracking';

const BATCH_SIZE = 50;

/**
 * Backfill `userWords.displayWord` for pre-existing rows.
 *
 * This migration ONLY updates `displayWord` — it does not touch counts,
 * create new `userWords` rows, or modify any other stats table. It walks
 * the same reviewed-card corpus as the original word tracking and, for
 * each word it finds in the source text, patches the matching `userWords`
 * row's `displayWord` to the correct casing.
 *
 * Rule for choosing the display form: if either the existing `displayWord`
 * or a newly-observed occurrence is all-lowercase, prefer the lowercase
 * form. Words that never appear lowercase (German nouns, proper nouns)
 * keep their capitalized form.
 *
 * Idempotent: safe to run multiple times.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const courses = await ctx.db.query('courses').take(500);

    let queued = 0;
    for (const course of courses) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillDisplayWord.processCourseBatch,
        { courseId: course._id, userId: course.userId },
      );
      queued++;
    }

    return { status: 'started', coursesQueued: queued };
  },
});

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
    let patched = 0;

    for (const card of result.page) {
      // Only look at cards that have been reviewed — those are the only
      // ones whose words exist in userWords.
      if (!card.lastReviewedAt) continue;

      const text = await ctx.db.get(card.textId);
      if (!text) continue;

      // Build language->text pairs (source text + all translations)
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

      for (const { language, text: sourceText } of langTexts) {
        const tokens = tokenizeText(sourceText, language);

        // Dedupe within this text, preferring lowercase when both seen.
        const seen = new Map<string, string>();
        for (const { normalized, original } of tokens) {
          const prev = seen.get(normalized);
          if (!prev || (isAllLowercase(original) && !isAllLowercase(prev))) {
            seen.set(normalized, original);
          }
        }

        for (const [normalized, original] of seen) {
          const row = await ctx.db
            .query('userWords')
            .withIndex('by_userId_and_courseId_and_language_and_word', (q) =>
              q
                .eq('userId', args.userId)
                .eq('courseId', args.courseId)
                .eq('language', language)
                .eq('word', normalized),
            )
            .first();
          if (!row) continue;

          const shouldPatch =
            row.displayWord === undefined ||
            (isAllLowercase(original) && !isAllLowercase(row.displayWord));
          if (shouldPatch) {
            await ctx.db.patch(row._id, { displayWord: original });
            patched++;
          }
        }
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillDisplayWord.processCourseBatch,
        {
          courseId: args.courseId,
          userId: args.userId,
          cursor: result.continueCursor,
        },
      );
    }

    return {
      processed: result.page.length,
      patched,
      isDone: result.isDone,
    };
  },
});

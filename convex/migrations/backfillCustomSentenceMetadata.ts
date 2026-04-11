import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { resolveAudioSpeakerGender } from '../../lib/languages';

const BATCH_SIZE = 25;
const MAX_TRANSLATIONS_FOR_METADATA = 6;

/**
 * Backfill linguistic metadata + audioSpeakerGender on existing texts.
 *
 * - Pre-made dataset rows (userCreated === false) with no audioSpeakerGender:
 *   simply patch audioSpeakerGender (coin-flip if speakerGender is missing/neutral). No LLM call.
 * - Custom rows (userCreated === true) with no speakerGender:
 *   schedule generateSentenceMetadata with up to 6 existing translations to infer the metadata
 *   via the LLM. The metadata action will then schedule prepareCardContent which deletes
 *   mismatched audio and regenerates voices to match the resolved gender.
 * - Custom rows with speakerGender already set but no audioSpeakerGender:
 *   patch audioSpeakerGender and schedule prepareCardContent.
 *
 * Run via: npx convex run migrations/backfillCustomSentenceMetadata:run
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.backfillCustomSentenceMetadata.processBatch,
      {},
    );
    return { status: 'started' };
  },
});

async function getCourseLanguagesForText(
  ctx: MutationCtx,
  text: Doc<'texts'>,
  cache: Map<string, { baseLanguages: string[]; targetLanguages: string[] } | null>,
): Promise<{ baseLanguages: string[]; targetLanguages: string[] } | null> {
  const key = text.collectionId as unknown as string;
  if (cache.has(key)) return cache.get(key) ?? null;

  // Find courseSettings whose chat/custom collection contains this text's collectionId.
  // Walk all courseSettings — typically a small number per active user; if a userId is
  // present we can scope by user via courses index.
  let resolved: { baseLanguages: string[]; targetLanguages: string[] } | null = null;

  if (text.userId) {
    const userCourses = await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', text.userId!))
      .take(20);
    for (const course of userCourses) {
      const settings = await ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
        .unique();
      if (!settings) continue;
      const owns =
        settings.chatCollectionId === text.collectionId ||
        settings.customCollectionId === text.collectionId ||
        (settings.activeCustomCollectionIds ?? []).includes(text.collectionId);
      if (owns) {
        resolved = {
          baseLanguages: course.baseLanguages,
          targetLanguages: course.targetLanguages,
        };
        break;
      }
    }
  }

  cache.set(key, resolved);
  return resolved;
}

export const processBatch = internalMutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query('texts').paginate({
      cursor: args.cursor ?? null,
      numItems: BATCH_SIZE,
    });

    const courseLanguagesCache = new Map<
      string,
      { baseLanguages: string[]; targetLanguages: string[] } | null
    >();

    let preMadePatched = 0;
    let customWithGenderPatched = 0;
    let metadataScheduled = 0;
    let skipped = 0;

    for (const text of result.page) {
      // Already has audioSpeakerGender — nothing to do.
      if (text.audioSpeakerGender) {
        skipped++;
        continue;
      }

      if (!text.userCreated) {
        // Pre-made dataset sentence: just resolve and patch.
        await ctx.db.patch(text._id, {
          audioSpeakerGender: resolveAudioSpeakerGender(text.speakerGender),
        });
        preMadePatched++;
        continue;
      }

      // Custom sentence.
      if (text.speakerGender) {
        // Linguistic metadata already present, just resolve audio gender.
        await ctx.db.patch(text._id, {
          audioSpeakerGender: resolveAudioSpeakerGender(text.speakerGender),
        });

        const langs = await getCourseLanguagesForText(ctx, text, courseLanguagesCache);
        if (langs) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.prepareCardContent,
            {
              textId: text._id,
              baseLanguages: langs.baseLanguages,
              targetLanguages: langs.targetLanguages,
            },
          );
        }
        customWithGenderPatched++;
        continue;
      }

      // Custom sentence with no metadata: collect translations and call the LLM.
      const langs = await getCourseLanguagesForText(ctx, text, courseLanguagesCache);
      if (!langs) {
        // No course found; can't schedule prepareCardContent meaningfully. Skip.
        skipped++;
        continue;
      }

      const translationRows = await ctx.db
        .query('translations')
        .withIndex('by_textId', (q) => q.eq('textId', text._id))
        .take(MAX_TRANSLATIONS_FOR_METADATA - 1);

      const translations = [
        { language: text.language, text: text.text },
        ...translationRows.map((r) => ({
          language: r.targetLanguage,
          text: r.translatedText,
        })),
      ].slice(0, MAX_TRANSLATIONS_FOR_METADATA);

      await ctx.scheduler.runAfter(
        0,
        internal.features.sentenceMetadata.generateSentenceMetadata,
        {
          textId: text._id,
          translations,
          schedulePrepareCard: true,
          baseLanguages: langs.baseLanguages,
          targetLanguages: langs.targetLanguages,
        },
      );
      metadataScheduled++;
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillCustomSentenceMetadata.processBatch,
        { cursor: result.continueCursor },
      );
    }

    return {
      processed: result.page.length,
      preMadePatched,
      customWithGenderPatched,
      metadataScheduled,
      skipped,
      isDone: result.isDone,
    };
  },
});

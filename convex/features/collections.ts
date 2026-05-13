import { v } from 'convex/values';
import { query, mutation, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { getAuthUserId } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import {
  getActiveDataset,
  getCollectionProgress,
  getNextTextsFromRank,
} from '../db/collections';
import { translationValidator, audioRecordingValidator } from '../types';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import { scheduleMissingContent } from './decks';
import {
  COLLECTION_PREVIEW_SIZE,
  CONTENT_LOOKAHEAD_SIZE,
  LEGACY_LEVEL_ORDER,
  isPremadeLevelCollection,
} from '../lib/collections';
import { getCourseSettings } from '../db/courseSettings';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function isCollectionAccessible(
  ctx: QueryCtx,
  collectionId: Id<'collections'>,
  courseId: Id<'courses'>,
): Promise<boolean> {
  const collection = await ctx.db.get(collectionId);
  if (!collection) return false;

  if (isPremadeLevelCollection(collection)) return true;

  const courseSettings = await getCourseSettings(ctx, courseId);
  if (!courseSettings) return false;

  if (courseSettings.chatCollectionId?.toString() === collectionId.toString()) return true;
  if (courseSettings.customCollectionId?.toString() === collectionId.toString()) return true;
  if (
    (courseSettings.activeCustomCollectionIds ?? []).some(
      (id) => id.toString() === collectionId.toString(),
    )
  )
    return true;

  return false;
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get the next COLLECTION_PREVIEW_SIZE texts from a collection with
 * translations and audio for all course languages.
 */
export const getCollectionTextsWithContent = query({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    texts: v.array(
      v.object({
        _id: v.id('texts'),
        text: v.string(),
        sourceLanguage: v.string(),
        translations: v.array(translationValidator),
        audioRecordings: v.array(audioRecordingValidator),
      }),
    ),
    hasMissingContent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { texts: [], hasMissingContent: false };

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { texts: [], hasMissingContent: false };
    const { course } = active;

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return { texts: [], hasMissingContent: false };
    }

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const progress = await getCollectionProgress(
      ctx,
      userId,
      course._id,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      COLLECTION_PREVIEW_SIZE,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );

    if (texts.length === 0) {
      return { texts: [], hasMissingContent: false };
    }

    const inputs = texts.map((text, i) => ({
      key: String(i),
      textId: text._id,
      sourceText: text.text,
      sourceLanguage: text.language,
      sourceRomanization: text.romanizedText ?? undefined,
    }));

    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      course.baseLanguages,
      course.targetLanguages,
    );

    let anyMissing = false;
    const enrichedTexts = texts.map((text, i) => {
      const content = contentMap.get(String(i))!;
      if (content.hasMissingContent) anyMissing = true;
      return {
        _id: text._id,
        text: text.text,
        sourceLanguage: text.language,
        translations: content.translations,
        audioRecordings: content.audioRecordings,
      };
    });

    return { texts: enrichedTexts, hasMissingContent: anyMissing };
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Ensure translations and audio exist for the next preview texts in a
 * collection.  The server determines which texts to process based on the
 * user's collection progress — the frontend only passes a collectionId.
 */
export const ensureContentForCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    totalTranslationsScheduled: v.number(),
    totalAudioScheduled: v.number(),
  }),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);

    if (!(await isCollectionAccessible(ctx, args.collectionId, course._id))) {
      return { totalTranslationsScheduled: 0, totalAudioScheduled: 0 };
    }

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? isPremadeLevelCollection(collection)
      : false;

    const progress = await getCollectionProgress(
      ctx,
      userId,
      course._id,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      CONTENT_LOOKAHEAD_SIZE,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );

    // Parallel over texts — each text writes only to its own (textId, language)
    // keyed rows, so no cross-text contention within this transaction.
    const results = await Promise.all(
      texts.map((text) =>
        scheduleMissingContent(
          ctx,
          text._id,
          text,
          course.baseLanguages,
          course.targetLanguages,
        ),
      ),
    );

    const totalTranslationsScheduled = results.reduce(
      (sum, r) => sum + r.translationsScheduled,
      0,
    );
    const totalAudioScheduled = results.reduce(
      (sum, r) => sum + r.audioScheduled,
      0,
    );

    return { totalTranslationsScheduled, totalAudioScheduled };
  },
});

/**
 * Ensure translations and audio exist for the FIRST 5 sentences of every
 * premade level collection in the active dataset (or legacy CEFR set) for
 * the given language pair. Scheduled from course creation
 * (`createCourse` / `completeOnboarding`) so that drilling into any level
 * later doesn't show a loading spinner.
 *
 * Internal because the only callers are the two course-creation paths,
 * which already know the course's language arrays — no auth lookup needed.
 *
 * Independent of user progress (unlike `ensureContentForCollection` which
 * paginates from `lastRankProcessed`) — always starts at collectionRank 1.
 *
 * Fans out one scheduled `ensureFirstSentencesForCollection` mutation per
 * level collection so each child runs in its own transaction; the inline
 * version exceeded Convex's per-mutation wallclock limit (~15s) once the
 * dataset grew to ~20 levels × 5 texts × multi-language storage.getUrl checks.
 */
export const ensureFirstSentencesAcrossLevelCollections = internalMutation({
  args: {
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.object({
    scheduledCollections: v.number(),
  }),
  handler: async (ctx, args) => {
    // Load only the ~20 premade level collections via indexed lookups so this
    // doesn't scan every user's custom/chat collections (which share the table).
    // Custom collections have no `datasetId` and don't share names with
    // LEGACY_LEVEL_ORDER, so both branches naturally exclude them.
    const activeDataset = await getActiveDataset(ctx);
    let levelCollections: Doc<'collections'>[];
    if (activeDataset) {
      levelCollections = await ctx.db
        .query('collections')
        .withIndex('by_datasetId_and_order', (q) =>
          q.eq('datasetId', activeDataset._id),
        )
        .collect();
    } else {
      const legacyDocs = await Promise.all(
        LEGACY_LEVEL_ORDER.map((name) =>
          ctx.db
            .query('collections')
            .withIndex('by_name', (q) => q.eq('name', name))
            .first(),
        ),
      );
      levelCollections = legacyDocs.filter(
        (c): c is Doc<'collections'> => c !== null,
      );
    }

    await Promise.all(
      levelCollections.map((collection) =>
        ctx.scheduler.runAfter(
          0,
          internal.features.collections.ensureFirstSentencesForCollection,
          {
            collectionId: collection._id,
            baseLanguages: args.baseLanguages,
            targetLanguages: args.targetLanguages,
          },
        ),
      ),
    );

    return { scheduledCollections: levelCollections.length };
  },
});

/**
 * Per-collection child of `ensureFirstSentencesAcrossLevelCollections`.
 *
 * Idempotent — `scheduleMissingContent` skips any (textId, language) already
 * covered, so re-entries do reads only and write nothing. Processes the 5
 * texts in parallel; safe because each text writes only to its own
 * (textId, language)-keyed rows (audio patches, claim inserts, per-text
 * scheduler calls).
 */
export const ensureFirstSentencesForCollection = internalMutation({
  args: {
    collectionId: v.id('collections'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const texts = await ctx.db
      .query('texts')
      .withIndex('by_collection_and_rank', (q) =>
        q.eq('collectionId', args.collectionId),
      )
      .order('asc')
      .take(COLLECTION_PREVIEW_SIZE);

    await Promise.all(
      texts.map((text) =>
        scheduleMissingContent(
          ctx,
          text._id,
          text,
          args.baseLanguages,
          args.targetLanguages,
        ),
      ),
    );
    return null;
  },
});

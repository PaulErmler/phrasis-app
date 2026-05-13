import { v } from 'convex/values';
import { query, mutation } from '../_generated/server';
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

    let totalTranslationsScheduled = 0;
    let totalAudioScheduled = 0;

    for (const text of texts) {
      const { translationsScheduled, audioScheduled } =
        await scheduleMissingContent(
          ctx,
          text._id,
          text,
          course.baseLanguages,
          course.targetLanguages,
        );
      totalTranslationsScheduled += translationsScheduled;
      totalAudioScheduled += audioScheduled;
    }


    return { totalTranslationsScheduled, totalAudioScheduled };
  },
});

/**
 * Ensure translations and audio exist for the FIRST 5 sentences of every
 * premade level collection accessible in the user's active course. Called
 * fire-and-forget from the home view on mount so when a user drills into any
 * level the preview is already populated.
 *
 * Independent of user progress (unlike `ensureContentForCollection` which
 * paginates from `lastRankProcessed`) — always starts at collectionRank 1.
 *
 * Idempotent: `scheduleMissingContent` skips any (textId, language) that's
 * already translated, so on re-entry this is ~35 DB lookups and zero writes.
 */
export const ensureFirstSentencesAcrossLevelCollections = mutation({
  args: {},
  returns: v.object({
    totalTranslationsScheduled: v.number(),
    totalAudioScheduled: v.number(),
  }),
  handler: async (ctx) => {
    const { course } = await requireActiveCourse(ctx);

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

    let totalTranslationsScheduled = 0;
    let totalAudioScheduled = 0;

    for (const collection of levelCollections) {
      // First COLLECTION_PREVIEW_SIZE (5) texts by rank — independent of
      // user progress so the home preview always shows translated content.
      const texts = await ctx.db
        .query('texts')
        .withIndex('by_collection_and_rank', (q) =>
          q.eq('collectionId', collection._id),
        )
        .order('asc')
        .take(COLLECTION_PREVIEW_SIZE);

      for (const text of texts) {
        const { translationsScheduled, audioScheduled } =
          await scheduleMissingContent(
            ctx,
            text._id,
            text,
            course.baseLanguages,
            course.targetLanguages,
          );
        totalTranslationsScheduled += translationsScheduled;
        totalAudioScheduled += audioScheduled;
      }
    }

    return { totalTranslationsScheduled, totalAudioScheduled };
  },
});

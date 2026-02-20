import { v } from 'convex/values';
import { query, mutation } from '../_generated/server';
import { getAuthUser } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import {
  getCollectionProgress,
  getNextTextsFromRank,
} from '../db/collections';
import { translationValidator, audioRecordingValidator } from '../types';
import { buildTextContentBatchForLanguages } from '../lib/cardContent';
import { scheduleMissingContent } from './decks';
import { COLLECTION_PREVIEW_SIZE } from '../lib/collections';

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
    const user = await getAuthUser(ctx);
    if (!user) return { texts: [], hasMissingContent: false };

    const active = await getActiveCourseForUser(ctx, user._id);
    if (!active) return { texts: [], hasMissingContent: false };
    const { course } = active;

    const progress = await getCollectionProgress(
      ctx,
      user._id,
      course._id,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      COLLECTION_PREVIEW_SIZE,
    );

    if (texts.length === 0) {
      return { texts: [], hasMissingContent: false };
    }

    const inputs = texts.map((text, i) => ({
      key: String(i),
      textId: text._id,
      sourceText: text.text,
      sourceLanguage: text.language,
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
    const { user, course } = await requireActiveCourse(ctx);

    const progress = await getCollectionProgress(
      ctx,
      user._id,
      course._id,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      COLLECTION_PREVIEW_SIZE,
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

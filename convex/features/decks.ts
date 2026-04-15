import { v, ConvexError } from 'convex/values';
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  internalAction,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import { insertCard } from '../db/stats/cardAggregates';
import {
  getVoiceForLanguage,
  getVoiceGenderByApiCode,
  resolveAudioSpeakerGender,
  getTtsProviderForLanguage,
} from '../../lib/languages';
import {
  getCourseSettings,
  setActiveCollectionOnSettings,
} from '../db/courseSettings';
import { getAuthUserId, requireAuthUserId, getUserSettings } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import {
  getCollectionProgress as getCollectionProgressHelper,
  getNextTextsFromRank,
} from '../db/collections';
import { translateText, romanizeText } from './translation';
import { ROMANIZATION_LANGUAGES } from '../../lib/languages';
import {
  translationValidator,
  audioRecordingValidator,
  ttsQualityValidator,
  ttsProviderValidator,
  voiceGenderValidator,
} from '../types';
import { claimTtsIfAvailable, hasActiveTtsClaim } from './ttsProcessing';
import { buildTextContentBatchForLanguages, buildCardSearchableText } from '../lib/cardContent';
import {
  LEVEL_ORDER,
  COLLECTION_PREVIEW_SIZE,
  CONTENT_LOOKAHEAD_SIZE,
  getNextCollectionName,
} from '../lib/collections';
import { DEFAULT_INITIAL_REVIEW_COUNT } from '../../lib/scheduling';
import { consumeQuota, checkQuota } from '../usage/helpers';
import { FEATURE_IDS } from './featureIds';
import { MAX_CARDS_PER_BATCH, ENSURE_CONTENT_LOOKAHEAD } from '../../lib/constants/learning';
import { isCollectionAccessible } from './collections';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Schedule missing translations and audio for a text.
 *
 * Used by both `prepareCardContent` (for new cards) and
 * `ensureCardContent` (for on-demand regeneration).
 */
export async function scheduleMissingContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sourceLanguage = text.language;

  // Resolve audioSpeakerGender: prefer existing valid value, fall back to speakerGender,
  // then coin-flip via resolveAudioSpeakerGender. Patch the text to make it durable.
  const storedGender = text.audioSpeakerGender;
  const audioSpeakerGender: 'male' | 'female' =
    storedGender === 'male' || storedGender === 'female'
      ? storedGender
      : resolveAudioSpeakerGender(text.speakerGender);
  if (storedGender !== audioSpeakerGender) {
    await ctx.db.patch(textId, { audioSpeakerGender });
  }

  const allRequiredLanguages = [
    ...new Set([...baseLanguages, ...targetLanguages]),
  ];

  // Languages that need translation (all except source)
  const langsNeedingTranslation = allRequiredLanguages.filter(
    (l) => l !== sourceLanguage,
  );

  // Batch load existing translations and audio for only the needed languages
  const [existingTranslations, existingAudio] = await Promise.all([
    Promise.all(
      langsNeedingTranslation.map((lang) =>
        ctx.db
          .query('translations')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('targetLanguage', lang),
          )
          .first(),
      ),
    ),
    Promise.all(
      allRequiredLanguages.map((lang) =>
        ctx.db
          .query('audioRecordings')
          .withIndex('by_text_and_language', (q) =>
            q.eq('textId', textId).eq('language', lang),
          )
          .first(),
      ),
    ),
  ]);

  // Build lookup maps
  const translationMap = new Map(
    langsNeedingTranslation.map((lang, i) => [lang, existingTranslations[i]]),
  );
  const audioMap = new Map(
    allRequiredLanguages.map((lang, i) => [lang, existingAudio[i]]),
  );

  // Validate storage files — delete stale rows where the file was removed.
  // Do not delete while TTS is in flight: `processTTSForCard` may have inserted
  // a row whose URL is not yet resolvable, or concurrent cleanup would remove
  // the row while later validation updates expect it to exist (silent no-op).
  for (const [lang, audio] of audioMap) {
    if (audio?.storageId) {
      const url = await ctx.storage.getUrl(audio.storageId);
      if (url === null) {
        if (await hasActiveTtsClaim(ctx, textId, lang)) {
          continue;
        }
        await ctx.db.delete(audio._id);
        audioMap.set(lang, null);
      } else {
        // Prefer the persisted gender; fall back to curated-list lookup for
        // legacy rows written before voiceGender existed.
        const storedGender =
          audio.voiceGender ?? getVoiceGenderByApiCode(audio.voiceName);
        // Unknown gender is itself a regenerate trigger — we can't trust the
        // audio to match the card's speakerGender, so rebuild it.
        const genderMismatch =
          storedGender === undefined ||
          ((audioSpeakerGender === 'male' || audioSpeakerGender === 'female') &&
            storedGender !== audioSpeakerGender);
        // Rows predating this field are legacy Google audio; treat as 'google'.
        const existingProvider = audio.ttsProvider ?? 'google';
        const providerMismatch =
          existingProvider !== getTtsProviderForLanguage(lang);
        if (genderMismatch || providerMismatch) {
          await ctx.storage.delete(audio.storageId);
          await ctx.db.delete(audio._id);
          audioMap.set(lang, null);
        }
      }
    }
  }

  let translationsScheduled = 0;
  let audioScheduled = 0;

  // Schedule romanization for source text if needed and missing
  if (ROMANIZATION_LANGUAGES.has(sourceLanguage) && !text.romanizedText) {
    await ctx.scheduler.runAfter(
      0,
      internal.features.decks.processRomanizationForSourceText,
      { textId, text: text.text, language: sourceLanguage },
    );
  }

  // Schedule missing content for each required language
  for (const lang of allRequiredLanguages) {
    const hasAudio = audioMap.get(lang) != null;

    if (lang === sourceLanguage) {
      // Source language — no translation needed, maybe TTS
      if (!hasAudio) {
        const claimed = await claimTtsIfAvailable(ctx, textId, lang);
        if (claimed) {
          const voiceName = getVoiceForLanguage(lang, audioSpeakerGender);
          const voiceGender = getVoiceGenderByApiCode(voiceName);
          if (voiceGender === undefined) {
            throw new Error(
              `Cannot enqueue TTS: voice "${voiceName}" for language "${lang}" is not in the curated voice list.`,
            );
          }
          await ctx.runMutation(
            internal.features.ttsProcessing.enqueueTtsJob,
            {
              provider: getTtsProviderForLanguage(lang),
              args: {
                textId,
                text: text.text,
                language: lang,
                voiceName,
                voiceGender,
                speed: 1,
              },
            },
          );
          audioScheduled++;
        }
      }
    } else {
      // Different language — need translation
      const translation = translationMap.get(lang);
      if (!translation) {
        // Schedule translation (which also triggers TTS and romanization after completion)
        await ctx.scheduler.runAfter(
          0,
          internal.features.decks.processTranslationForCard,
          {
            textId,
            sourceLanguage,
            targetLanguage: lang,
            text: text.text,
            audioSpeakerGender,
          },
        );
        translationsScheduled++;
      } else {
        // Translation exists — backfill romanization if missing
        if (ROMANIZATION_LANGUAGES.has(lang) && !translation.romanizedText) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.processRomanizationForTranslation,
            { textId, translatedText: translation.translatedText, language: lang },
          );
        }
        if (!hasAudio) {
          const claimed = await claimTtsIfAvailable(ctx, textId, lang);
          if (claimed) {
            const voiceName = getVoiceForLanguage(lang, audioSpeakerGender);
            const voiceGender = getVoiceGenderByApiCode(voiceName);
            if (voiceGender === undefined) {
              throw new Error(
                `Cannot enqueue TTS: voice "${voiceName}" for language "${lang}" is not in the curated voice list.`,
              );
            }
            await ctx.runMutation(
              internal.features.ttsProcessing.enqueueTtsJob,
              {
                provider: getTtsProviderForLanguage(lang),
                args: {
                  textId,
                  text: translation.translatedText,
                  language: lang,
                  voiceName,
                  voiceGender,
                  speed: 1,
                },
              },
            );
            audioScheduled++;
          }
        }
      }
    }
  }

  return { translationsScheduled, audioScheduled };
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get cards in the user's deck with translations and audio (paginated).
 *
 * Each card includes a `hasMissingContent` flag. If true, the frontend should
 * call `ensureCardContent` to trigger regeneration.
 */
export const getDeckCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('cards'),
      _creationTime: v.number(),
      textId: v.id('texts'),
      sourceText: v.string(),
      sourceLanguage: v.string(),
      translations: v.array(translationValidator),
      audioRecordings: v.array(audioRecordingValidator),
      dueDate: v.number(),
      isMastered: v.boolean(),
      isHidden: v.boolean(),
      isFavorite: v.optional(v.boolean()),
      hasMissingContent: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return [];
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return [];

    const maxCards = args.limit ?? 20;
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .take(maxCards);

    const texts = await Promise.all(cards.map((c) => ctx.db.get(c.textId)));

    const inputs = cards
      .map((card, i) => {
        const text = texts[i];
        if (!text) return null;
        return {
          key: String(i),
          textId: card.textId,
          sourceText: text.text,
          sourceLanguage: text.language,
          sourceRomanization: text.romanizedText ?? undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const contentMap = await buildTextContentBatchForLanguages(
      ctx,
      inputs,
      course.baseLanguages,
      course.targetLanguages,
    );

    const result = cards.map((card, i) => {
      const text = texts[i];
      if (!text) return null;
      const content = contentMap.get(String(i));
      if (!content) return null;

      return {
        _id: card._id,
        _creationTime: card._creationTime,
        textId: card.textId,
        sourceText: text.text,
        sourceLanguage: text.language,
        translations: content.translations,
        audioRecordings: content.audioRecordings,
        dueDate: card.dueDate,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite ?? false,
        hasMissingContent: content.hasMissingContent,
      };
    });

    return result.filter(
      (card): card is NonNullable<typeof card> => card !== null,
    );
  },
});

/**
 * Get collection progress for all collections in the active course.
 */
export const getCollectionProgress = query({
  args: {},
  returns: v.array(
    v.object({
      collectionId: v.id('collections'),
      collectionName: v.string(),
      cardsAdded: v.number(),
      totalTexts: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const settings = await getUserSettings(ctx, userId);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;
    const allCollections = await ctx.db.query('collections').collect();
    const levelOrder: readonly string[] = LEVEL_ORDER;

    // Only include difficulty-level collections in this query
    const collections = allCollections.filter((c) =>
      levelOrder.includes(c.name),
    );

    const result = await Promise.all(
      collections.map(async (collection) => {
        const progress = await getCollectionProgressHelper(
          ctx,
          userId,
          courseId,
          collection._id,
        );

        return {
          collectionId: collection._id,
          collectionName: collection.name,
          cardsAdded: progress?.cardsAdded ?? 0,
          totalTexts: collection.textCount,
        };
      }),
    );

    result.sort((a, b) => {
      const aIndex = levelOrder.indexOf(a.collectionName);
      const bIndex = levelOrder.indexOf(b.collectionName);
      return aIndex - bIndex;
    });

    return result;
  },
});

export const getCustomCollectionsProgress = query({
  args: {},
  returns: v.array(
    v.object({
      collectionId: v.id('collections'),
      collectionName: v.string(),
      cardsAdded: v.number(),
      totalTexts: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const settings = await getUserSettings(ctx, userId);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;
    const courseSettings = await getCourseSettings(ctx, courseId);

    // Collect course-specific custom collection IDs (chat-approved + manually entered)
    const customCollectionIds: Id<'collections'>[] = [];
    const seen = new Set<string>();
    for (const id of [
      courseSettings?.chatCollectionId,
      courseSettings?.customCollectionId,
    ]) {
      if (id && !seen.has(id)) {
        seen.add(id);
        customCollectionIds.push(id);
      }
    }

    if (customCollectionIds.length === 0) return [];

    const result = await Promise.all(
      customCollectionIds.map(async (collectionId) => {
        const collection = await ctx.db.get(collectionId);
        if (!collection) return null;

        const progress = await getCollectionProgressHelper(
          ctx,
          userId,
          courseId,
          collectionId,
        );

        return {
          collectionId: collection._id,
          collectionName: collection.name,
          cardsAdded: progress?.cardsAdded ?? 0,
          totalTexts: collection.textCount,
        };
      }),
    );

    return result.filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
  },
});

/**
 * Get the next N texts from a collection that haven't been added to the deck yet.
 * Uses collectionProgress.lastRankProcessed for efficient pagination.
 */
export const getNextTextsFromCollection = query({
  args: {
    collectionId: v.id('collections'),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id('texts'),
      text: v.string(),
      collectionRank: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const settings = await getUserSettings(ctx, userId);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;

    if (!(await isCollectionAccessible(ctx, args.collectionId, courseId))) {
      return [];
    }

    const maxTexts = Math.min(args.limit ?? 5, 20);

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      args.collectionId,
    );
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const collection = await ctx.db.get(args.collectionId);
    const isLevelCollection = collection
      ? (LEVEL_ORDER as readonly string[]).includes(collection.name)
      : false;

    const texts = await getNextTextsFromRank(
      ctx,
      args.collectionId,
      lastRankProcessed,
      maxTexts,
      isLevelCollection ? { onlyCurriculum: true } : { forUserId: userId },
    );

    return texts.map((t) => ({
      _id: t._id,
      text: t.text,
      collectionRank: t.collectionRank,
    }));
  },
});

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Set the active collection for the user's current course.
 */
export const setActiveCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) throw new ConvexError('Collection not found');

    const isLevelCollection = (LEVEL_ORDER as readonly string[]).includes(collection.name);
    if (!isLevelCollection) {
      const courseSettings = await getCourseSettings(ctx, courseId);
      const isChatCollection =
        courseSettings?.chatCollectionId?.toString() === args.collectionId.toString();
      const isCustomCollection = (courseSettings?.activeCustomCollectionIds ?? []).some(
        (id) => id.toString() === args.collectionId.toString(),
      );
      if (!isChatCollection && !isCustomCollection) {
        throw new ConvexError('Collection not accessible');
      }
    }

    const progress = await getCollectionProgressHelper(
      ctx,
      userId,
      courseId,
      args.collectionId,
    );

    if (progress && progress.cardsAdded >= collection.textCount) {
      throw new ConvexError('This collection is already complete');
    }

    await setActiveCollectionOnSettings(ctx, courseId, args.collectionId);
    return null;
  },
});

/**
 * Toggle a custom collection's selection for automatic card inclusion.
 */
export const toggleCustomCollection = mutation({
  args: {
    collectionId: v.id('collections'),
  },
  returns: v.object({
    selected: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const collection = await ctx.db.get(args.collectionId);
    if (!collection) throw new ConvexError('Collection not found');

    const isLevelCollection = (LEVEL_ORDER as readonly string[]).includes(collection.name);
    if (isLevelCollection) {
      throw new ConvexError('Cannot toggle a level collection');
    }

    const courseSettings = await getCourseSettings(ctx, courseId);

    const isChatCollection =
      courseSettings?.chatCollectionId?.toString() === args.collectionId.toString();
    const isCustomCollection =
      courseSettings?.customCollectionId?.toString() === args.collectionId.toString();
    const isAlreadyCustom = (courseSettings?.activeCustomCollectionIds ?? []).some(
      (id) => id.toString() === args.collectionId.toString(),
    );
    if (!isChatCollection && !isCustomCollection && !isAlreadyCustom) {
      throw new ConvexError('Collection not accessible');
    }

    const currentIds = courseSettings?.activeCustomCollectionIds ?? [];
    const idStr = args.collectionId.toString();
    const isCurrentlySelected = currentIds.some((id) => id.toString() === idStr);

    const newIds = isCurrentlySelected
      ? currentIds.filter((id) => id.toString() !== idStr)
      : [...currentIds, args.collectionId];

    if (courseSettings) {
      await ctx.db.patch(courseSettings._id, {
        activeCustomCollectionIds: newIds,
      });
    } else {
      await ctx.db.insert('courseSettings', {
        courseId,
        initialReviewCount: DEFAULT_INITIAL_REVIEW_COUNT,
        activeCustomCollectionIds: newIds,
      });
    }

    return { selected: !isCurrentlySelected };
  },
});

/**
 * Creates cards from a list of texts and returns count of new cards inserted.
 * Shared by both chat-collection and difficulty-collection card creation.
 */
export async function createCardsFromTexts(
  ctx: MutationCtx,
  texts: Doc<'texts'>[],
  deck: Doc<'decks'>,
  collectionId: Id<'collections'>,
  course: Doc<'courses'>,
): Promise<{ cardsInserted: number; newLastRank: number }> {
  const now = Date.now();
  let cardsInserted = 0;
  let newLastRank = 0;

  for (const text of texts) {
    if (text.collectionRank > newLastRank) {
      newLastRank = text.collectionRank;
    }

    const existingCard = await getCardByDeckAndText(ctx, deck._id, text._id);

    if (!existingCard) {
      const courseLanguages = [...course.baseLanguages, ...course.targetLanguages];
      const { searchableText, searchableTextLanguages } =
        await buildCardSearchableText(ctx, text._id, text.text, courseLanguages);

      await insertCard(ctx, {
        deckId: deck._id,
        textId: text._id,
        collectionId,
        dueDate: now + cardsInserted,
        isMastered: false,
        isHidden: false,
        isFavorite: false,
        isGraduated: false,
        schedulingPhase: 'preReview' as const,
        preReviewCount: 0,
        searchableText,
        searchableTextLanguages,
      });
      cardsInserted++;
    }
  }

  return { cardsInserted, newLastRank };
}

/**
 * Updates collection progress after adding cards.
 */
export async function updateCollectionProgress(
  ctx: MutationCtx,
  userId: string,
  courseId: Id<'courses'>,
  collectionId: Id<'collections'>,
  textsProcessed: number,
  newLastRank: number,
): Promise<void> {
  const progress = await getCollectionProgressHelper(
    ctx,
    userId,
    courseId,
    collectionId,
  );

  if (progress) {
    await ctx.db.patch(progress._id, {
      cardsAdded: progress.cardsAdded + textsProcessed,
      lastRankProcessed: Math.max(progress.lastRankProcessed ?? 0, newLastRank),
    });
  } else {
    await ctx.db.insert('collectionProgress', {
      userId,
      courseId,
      collectionId,
      cardsAdded: textsProcessed,
      lastRankProcessed: newLastRank,
    });
  }
}

/**
 * Add cards from a collection to the user's deck.
 * Chat-collection texts are prioritized before the difficulty collection.
 */
export const addCardsFromCollection = mutation({
  args: {
    collectionId: v.id('collections'),
    batchSize: v.number(),
    /** When true, only add from this specific collection — skip custom collection mixing. */
    exclusive: v.optional(v.boolean()),
  },
  returns: v.object({
    cardsAdded: v.number(),
    totalCardsInDeck: v.number(),
  }),
  handler: async (ctx, args) => {
    const { userId, settings, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    const clampedBatchSize = Math.max(1, Math.min(MAX_CARDS_PER_BATCH, Math.floor(args.batchSize)));

    // Get or create deck
    let deck = await getDeckByCourseId(ctx, courseId);
    if (!deck) {
      const deckId = await ctx.db.insert('decks', {
        courseId,
        name: `Learning ${course.targetLanguages.join(', ')}`,
        cardCount: 0,
      });
      deck = await ctx.db.get(deckId);
      if (!deck) throw new ConvexError('Failed to create deck');
    }

    let totalCardsInserted = 0;
    let totalTextsProcessed = 0;
    let remainingBatch = clampedBatchSize;

    // --- Phase 1: Add from custom collection(s) ---
    // When the requested collection is a level collection (learning mode auto-add),
    // drain pending texts from ALL selected custom collections randomly.
    // When the requested collection is a custom collection (collection detail "add" button),
    // only add from that specific collection.
    const courseSettings = await getCourseSettings(ctx, courseId);
    const requestedCollection = await ctx.db.get(args.collectionId);
    const isLevelCollection = requestedCollection
      ? (LEVEL_ORDER as readonly string[]).includes(requestedCollection.name)
      : false;

    const customCollectionIdsToProcess: Id<'collections'>[] = args.exclusive
      ? (isLevelCollection
        ? []
        : [args.collectionId])
      : isLevelCollection
        ? (courseSettings?.activeCustomCollectionIds ?? [])
        : [args.collectionId].filter((id) =>
          courseSettings?.chatCollectionId?.toString() === id.toString() ||
            courseSettings?.customCollectionId?.toString() === id.toString() ||
            (courseSettings?.activeCustomCollectionIds ?? []).some(
              (cid) => cid.toString() === id.toString(),
            ),
        );

    if (customCollectionIdsToProcess.length > 0 && remainingBatch > 0) {
      const collectionsWithPending: {
        id: Id<'collections'>;
        collection: Doc<'collections'>;
        lastRank: number;
        pendingCount: number;
      }[] = [];

      for (const collId of customCollectionIdsToProcess) {
        const coll = await ctx.db.get(collId);
        if (!coll) continue;
        const prog = await getCollectionProgressHelper(ctx, userId, courseId, collId);
        const lastRank = prog?.lastRankProcessed ?? 0;
        const cardsAdded = prog?.cardsAdded ?? 0;
        const pending = coll.textCount - cardsAdded;
        if (pending > 0) {
          collectionsWithPending.push({
            id: collId,
            collection: coll,
            lastRank,
            pendingCount: pending,
          });
        }
      }

      if (collectionsWithPending.length > 0) {
        const allocations = new Map<string, number>();
        const pool = [...collectionsWithPending];
        let remaining = remainingBatch;

        while (remaining > 0 && pool.length > 0) {
          const idx = Math.floor(Math.random() * pool.length);
          const entry = pool[idx];
          const key = entry.id.toString();
          allocations.set(key, (allocations.get(key) ?? 0) + 1);
          entry.pendingCount--;
          if (entry.pendingCount <= 0) pool.splice(idx, 1);
          remaining--;
        }

        for (const entry of collectionsWithPending) {
          const count = allocations.get(entry.id.toString()) ?? 0;
          if (count === 0) continue;

          const texts = await getNextTextsFromRank(ctx, entry.id, entry.lastRank, count, { forUserId: userId });
          if (texts.length === 0) continue;

          const { cardsInserted, newLastRank } = await createCardsFromTexts(
            ctx, texts, deck, entry.id, course,
          );

          totalCardsInserted += cardsInserted;
          totalTextsProcessed += texts.length;
          remainingBatch -= texts.length;

          await updateCollectionProgress(
            ctx, userId, courseId, entry.id, texts.length, newLastRank,
          );

          for (const text of texts) {
            await ctx.scheduler.runAfter(
              0, internal.features.decks.prepareCardContent,
              { textId: text._id, baseLanguages: course.baseLanguages, targetLanguages: course.targetLanguages },
            );
          }

          const customFinalRank = Math.max(entry.lastRank, newLastRank);
          const upcomingCustomTexts = await getNextTextsFromRank(
            ctx, entry.id, customFinalRank, CONTENT_LOOKAHEAD_SIZE, { forUserId: userId },
          );
          for (const text of upcomingCustomTexts) {
            await ctx.scheduler.runAfter(
              0, internal.features.decks.prepareCardContent,
              { textId: text._id, baseLanguages: course.baseLanguages, targetLanguages: course.targetLanguages },
            );
          }
        }
      }
    }

    // --- Phase 2: Fill remaining batch from the difficulty collection (only for level collections) ---
    if (isLevelCollection && remainingBatch > 0) {
      // Deduct sentences quota for difficulty-collection cards
      const quota = await checkQuota(ctx, userId, FEATURE_IDS.SENTENCES, remainingBatch);
      if (quota.synced && !quota.allowed) {
        // Clamp to whatever balance is left
        if (quota.balance > 0) {
          remainingBatch = quota.balance;
        } else {
          // No sentences left — skip Phase 2 entirely, return Phase 1 results
          if (totalCardsInserted > 0) {
            await ctx.db.patch(deck._id, { cardCount: deck.cardCount + totalCardsInserted });
          }
          return {
            cardsAdded: totalTextsProcessed,
            totalCardsInDeck: deck.cardCount + totalCardsInserted,
          };
        }
      }

      const progress = await getCollectionProgressHelper(
        ctx,
        userId,
        courseId,
        args.collectionId,
      );

      const cardsAlreadyAdded = progress?.cardsAdded ?? 0;
      const lastRankProcessed = progress?.lastRankProcessed ?? 0;

      const textsToAdd = await getNextTextsFromRank(
        ctx,
        args.collectionId,
        lastRankProcessed,
        remainingBatch,
        { onlyCurriculum: true },
      );

      if (textsToAdd.length > 0) {
        await consumeQuota(ctx, userId, FEATURE_IDS.SENTENCES, textsToAdd.length);

        const { cardsInserted, newLastRank } = await createCardsFromTexts(
          ctx,
          textsToAdd,
          deck,
          args.collectionId,
          course,
        );

        totalCardsInserted += cardsInserted;
        totalTextsProcessed += textsToAdd.length;

        await updateCollectionProgress(
          ctx,
          userId,
          courseId,
          args.collectionId,
          textsToAdd.length,
          newLastRank,
        );

        for (const text of textsToAdd) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.prepareCardContent,
            {
              textId: text._id,
              baseLanguages: course.baseLanguages,
              targetLanguages: course.targetLanguages,
            },
          );
        }

        const finalLastRank = Math.max(lastRankProcessed, newLastRank);
        const upcomingTexts = await getNextTextsFromRank(
          ctx,
          args.collectionId,
          finalLastRank,
          CONTENT_LOOKAHEAD_SIZE,
          { onlyCurriculum: true },
        );

        for (const text of upcomingTexts) {
          await ctx.scheduler.runAfter(
            0,
            internal.features.decks.prepareCardContent,
            {
              textId: text._id,
              baseLanguages: course.baseLanguages,
              targetLanguages: course.targetLanguages,
            },
          );
        }

        // Auto-advance: if the collection is now complete and is the active one,
        // move to the next incomplete collection (or clear if last).
        const newCardsAdded = cardsAlreadyAdded + textsToAdd.length;
        const collection = await ctx.db.get(args.collectionId);
        if (collection && newCardsAdded >= collection.textCount) {
          const latestSettings = await getCourseSettings(ctx, courseId);
          if (
            latestSettings?.activeCollectionId?.toString() ===
            args.collectionId.toString()
          ) {
            let nextCollectionId: Id<'collections'> | undefined;
            const nextName = getNextCollectionName(collection.name);

            if (nextName) {
              const allCollections = await ctx.db.query('collections').collect();
              const orderedNames: readonly string[] = LEVEL_ORDER;
              const startIdx = orderedNames.indexOf(nextName);

              for (let i = startIdx; i < orderedNames.length; i++) {
                const coll = allCollections.find((c) => c.name === orderedNames[i]);
                if (!coll) continue;

                const prog = await getCollectionProgressHelper(
                  ctx,
                  userId,
                  courseId,
                  coll._id,
                );

                if (!prog || prog.cardsAdded < coll.textCount) {
                  nextCollectionId = coll._id;
                  break;
                }
              }
            }

            await setActiveCollectionOnSettings(ctx, courseId, nextCollectionId);
          }
        }
      }
    }

    // Update deck card count
    if (totalCardsInserted > 0) {
      await ctx.db.patch(deck._id, { cardCount: deck.cardCount + totalCardsInserted });
    }

    return {
      cardsAdded: totalTextsProcessed,
      totalCardsInDeck: deck.cardCount + totalCardsInserted,
    };
  },
});

/**
 * Ensure content (translations + audio) exists for a specific card.
 * Called automatically when a card is displayed and has missing content.
 */
export const ensureCardContent = mutation({
  args: {
    textId: v.id('texts'),
  },
  returns: v.object({
    translationsScheduled: v.number(),
    audioScheduled: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthUserId(ctx);

    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return { translationsScheduled: 0, audioScheduled: 0 };

    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return { translationsScheduled: 0, audioScheduled: 0 };

    // Verify the user actually has a card for this text in their deck
    const card = await getCardByDeckAndText(ctx, deck._id, args.textId);
    if (!card) return { translationsScheduled: 0, audioScheduled: 0 };

    const text = await ctx.db.get(args.textId);
    if (!text) return { translationsScheduled: 0, audioScheduled: 0 };

    return scheduleMissingContent(
      ctx,
      args.textId,
      text,
      active.course.baseLanguages,
      active.course.targetLanguages,
    );
  },
});

/**
 * Ensure content for the next N due cards in the user's active deck.
 * Called from the learning mode to pre-generate translations and audio
 * for upcoming cards so they're ready before the user reaches them.
 */
export const ensureUpcomingCardsContent = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await requireAuthUserId(ctx);
    const active = await getActiveCourseForUser(ctx, userId);
    if (!active) return 0;
    const deck = await getDeckByCourseId(ctx, active.course._id);
    if (!deck) return 0;

    const settings = await getCourseSettings(ctx, active.course._id);
    const schedulingMode = settings?.schedulingMode ?? 'learnAndReview';

    const now = Date.now();
    let cards;
    if (schedulingMode === 'learn_new') {
      cards = await ctx.db
        .query('cards')
        .withIndex('by_deck_hidden_mastered_graduated_due', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .eq('isGraduated', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(ENSURE_CONTENT_LOOKAHEAD);
    } else {
      cards = await ctx.db
        .query('cards')
        .withIndex('by_deckId_and_isHidden_and_isMastered_and_dueDate', (q) =>
          q
            .eq('deckId', deck._id)
            .eq('isHidden', false)
            .eq('isMastered', false)
            .lte('dueDate', now),
        )
        .order('asc')
        .take(ENSURE_CONTENT_LOOKAHEAD);
    }

    let processed = 0;
    for (const card of cards) {
      const text = await ctx.db.get(card.textId);
      if (!text) continue;
      await scheduleMissingContent(
        ctx,
        card.textId,
        text,
        active.course.baseLanguages,
        active.course.targetLanguages,
      );
      processed++;
    }
    return processed;
  },
});

// ============================================================================
// INTERNAL FUNCTIONS
// ============================================================================

/**
 * Internal mutation to prepare card content (translations + TTS).
 */
export const prepareCardContent = internalMutation({
  args: {
    textId: v.id('texts'),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    if (!text) return null;

    await scheduleMissingContent(
      ctx,
      args.textId,
      text,
      args.baseLanguages,
      args.targetLanguages,
    );
    return null;
  },
});

/**
 * Internal query: translation row for idempotency before calling Google Translate.
 */
export const getTranslationForTextLanguage = internalQuery({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      translatedText: v.string(),
      romanizedText: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();
    if (!row) return null;
    return {
      translatedText: row.translatedText,
      romanizedText: row.romanizedText,
    };
  },
});

/**
 * Internal action to process translation for a card.
 */
export const processTranslationForCard = internalAction({
  args: {
    textId: v.id('texts'),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    text: v.string(),
    audioSpeakerGender: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const existingRow = await ctx.runQuery(
        internal.features.decks.getTranslationForTextLanguage,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
        },
      );

      let translation: string;
      let romanizedText: string | undefined;

      if (existingRow) {
        translation = existingRow.translatedText;
        if (ROMANIZATION_LANGUAGES.has(args.targetLanguage) && !existingRow.romanizedText) {
          try {
            romanizedText = await romanizeText(translation, args.targetLanguage);
          } catch {
            // Romanization is non-fatal; skip silently
          }
        } else {
          romanizedText = existingRow.romanizedText;
        }
      } else {
        translation = await translateText(
          args.text,
          args.sourceLanguage,
          args.targetLanguage,
        );
        if (ROMANIZATION_LANGUAGES.has(args.targetLanguage)) {
          try {
            romanizedText = await romanizeText(translation, args.targetLanguage);
          } catch {
            // Romanization is non-fatal; skip silently
          }
        }
      }

      const voiceName = getVoiceForLanguage(args.targetLanguage, args.audioSpeakerGender);

      await ctx.runMutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          translatedText: translation,
          voiceName,
          romanizedText,
        },
      );
    } catch (err) {
      console.error('[translateCard] Translation error:', {
        textId: args.textId,
        sourceLanguage: args.sourceLanguage,
        targetLanguage: args.targetLanguage,
        error: err,
      });
    }

    return null;
  },
});

/**
 * Internal mutation to store a translation and schedule TTS generation.
 */
export const storeTranslationAndScheduleTTS = internalMutation({
  args: {
    textId: v.id('texts'),
    targetLanguage: v.string(),
    translatedText: v.string(),
    voiceName: v.string(),
    romanizedText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.targetLanguage),
      )
      .first();

    if (!existing) {
      await ctx.db.insert('translations', {
        textId: args.textId,
        targetLanguage: args.targetLanguage,
        translatedText: args.translatedText,
        ...(args.romanizedText ? { romanizedText: args.romanizedText } : {}),
      });
    } else if (args.romanizedText && !existing.romanizedText) {
      await ctx.db.patch(existing._id, { romanizedText: args.romanizedText });
    }

    const existingAudioForVoice = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language_and_voiceName', (q) =>
        q
          .eq('textId', args.textId)
          .eq('language', args.targetLanguage)
          .eq('voiceName', args.voiceName),
      )
      .first();

    if (!existingAudioForVoice) {
      const claimed = await claimTtsIfAvailable(ctx, args.textId, args.targetLanguage);
      if (claimed) {
        const voiceGender = getVoiceGenderByApiCode(args.voiceName);
        if (voiceGender === undefined) {
          throw new Error(
            `Cannot enqueue TTS: voice "${args.voiceName}" for language "${args.targetLanguage}" is not in the curated voice list.`,
          );
        }
        await ctx.runMutation(
          internal.features.ttsProcessing.enqueueTtsJob,
          {
            provider: getTtsProviderForLanguage(args.targetLanguage),
            args: {
              textId: args.textId,
              text: args.translatedText,
              language: args.targetLanguage,
              voiceName: args.voiceName,
              voiceGender,
              speed: 1,
            },
          },
        );
      }
    }

    return null;
  },
});

/**
 * Internal action to romanize a source text (in the texts table).
 */
export const processRomanizationForSourceText = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const romanized = await romanizeText(args.text, args.language);
      await ctx.runMutation(
        internal.features.decks.storeSourceRomanization,
        { textId: args.textId, romanizedText: romanized },
      );
    } catch (err) {
      console.error('Source romanization error:', err);
    }
    return null;
  },
});

/**
 * Internal mutation to store romanized text on a source text document.
 */
export const storeSourceRomanization = internalMutation({
  args: {
    textId: v.id('texts'),
    romanizedText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    if (text && !text.romanizedText) {
      await ctx.db.patch(args.textId, { romanizedText: args.romanizedText });
    }
    return null;
  },
});

/**
 * Internal action to romanize an existing translation (backfill).
 */
export const processRomanizationForTranslation = internalAction({
  args: {
    textId: v.id('texts'),
    translatedText: v.string(),
    language: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const romanized = await romanizeText(args.translatedText, args.language);
      await ctx.runMutation(
        internal.features.decks.storeTranslationRomanization,
        { textId: args.textId, language: args.language, romanizedText: romanized },
      );
    } catch (err) {
      console.error('Translation romanization error:', err);
    }
    return null;
  },
});

/**
 * Internal mutation to store romanized text on a translation document.
 */
export const storeTranslationRomanization = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    romanizedText: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const translation = await ctx.db
      .query('translations')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('targetLanguage', args.language),
      )
      .first();
    if (translation && !translation.romanizedText) {
      await ctx.db.patch(translation._id, { romanizedText: args.romanizedText });
    }
    return null;
  },
});

/**
 * Internal mutation to store an audio recording.
 */
export const storeAudioRecording = internalMutation({
  args: {
    textId: v.id('texts'),
    language: v.string(),
    voiceName: v.string(),
    storageId: v.id('_storage'),
    ttsQuality: v.optional(ttsQualityValidator),
    ttsProvider: v.optional(ttsProviderValidator),
    voiceGender: voiceGenderValidator,
    speed: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existingForVoice = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language_and_voiceName', (q) =>
        q
          .eq('textId', args.textId)
          .eq('language', args.language)
          .eq('voiceName', args.voiceName),
      )
      .first();
    const existingAnyVoice = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();
    if (!existingForVoice && !existingAnyVoice) {
      await ctx.db.insert('audioRecordings', {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId: args.storageId,
        ttsQuality: args.ttsQuality,
        ttsProvider: args.ttsProvider,
        voiceGender: args.voiceGender,
        speed: args.speed,
      });
      return null;
    }

    const recordToUpdate = existingForVoice ?? existingAnyVoice;
    if (!recordToUpdate) return null;

    const previousStorageId = recordToUpdate.storageId;
    await ctx.db.patch(recordToUpdate._id, {
      voiceName: args.voiceName,
      storageId: args.storageId,
      ttsQuality: args.ttsQuality,
      ttsProvider: args.ttsProvider,
      voiceGender: args.voiceGender,
      speed: args.speed,
    });
    if (previousStorageId !== args.storageId) {
      await ctx.storage.delete(previousStorageId);
    }
    return null;
  },
});

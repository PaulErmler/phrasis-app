import { v, ConvexError } from 'convex/values';
import {
  mutation,
  query,
  internalMutation,
  internalAction,
  MutationCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import { Id, Doc } from '../_generated/dataModel';
import { getRandomVoiceForLanguage } from '../../lib/languages';
import {
  getCourseSettings,
  setActiveCollectionOnSettings,
} from '../db/courseSettings';
import { getAuthUser, requireAuthUser, getUserSettings } from '../db/users';
import { getActiveCourseForUser, requireActiveCourse } from '../db/courses';
import { getDeckByCourseId, getCardByDeckAndText } from '../db/decks';
import { translateText } from './translation';
import { synthesizeSpeech } from './tts';
import { translationValidator, audioRecordingValidator } from '../types';
import { LEVEL_ORDER, getNextCollectionName } from '../lib/collections';

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Schedule missing translations and audio for a text.
 *
 * Used by both `prepareCardContent` (for new cards) and
 * `ensureCardContent` (for on-demand regeneration).
 */
async function scheduleMissingContent(
  ctx: MutationCtx,
  textId: Id<'texts'>,
  text: Doc<'texts'>,
  baseLanguages: string[],
  targetLanguages: string[],
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sourceLanguage = text.language;
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

  // Validate storage files — delete stale rows where the file was removed
  for (const [lang, audio] of audioMap) {
    if (audio?.storageId) {
      const url = await ctx.storage.getUrl(audio.storageId);
      if (url === null) {
        await ctx.db.delete(audio._id);
        audioMap.set(lang, null);
      }
    }
  }

  let translationsScheduled = 0;
  let audioScheduled = 0;

  // Schedule missing content for each required language
  for (const lang of allRequiredLanguages) {
    const hasAudio = audioMap.get(lang) != null;

    if (lang === sourceLanguage) {
      // Source language — no translation needed, maybe TTS
      if (!hasAudio) {
        const voiceName = getRandomVoiceForLanguage(lang);
        await ctx.scheduler.runAfter(
          0,
          internal.features.decks.processTTSForCard,
          {
            textId,
            text: text.text,
            language: lang,
            voiceName,
          },
        );
        audioScheduled++;
      }
    } else {
      // Different language — need translation
      const translation = translationMap.get(lang);
      if (!translation) {
        // Schedule translation (which also triggers TTS after completion)
        await ctx.scheduler.runAfter(
          0,
          internal.features.decks.processTranslationForCard,
          {
            textId,
            sourceLanguage,
            targetLanguage: lang,
            text: text.text,
          },
        );
        translationsScheduled++;
      } else if (!hasAudio) {
        // Translation exists but TTS is missing
        const voiceName = getRandomVoiceForLanguage(lang);
        await ctx.scheduler.runAfter(
          0,
          internal.features.decks.processTTSForCard,
          {
            textId,
            text: translation.translatedText,
            language: lang,
            voiceName,
          },
        );
        audioScheduled++;
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
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const active = await getActiveCourseForUser(ctx, user._id);
    if (!active) return [];
    const { course } = active;

    const deck = await getDeckByCourseId(ctx, course._id);
    if (!deck) return [];

    const maxCards = args.limit ?? 20;
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deck._id))
      .take(maxCards);

    const allLanguages = [
      ...new Set([...course.baseLanguages, ...course.targetLanguages]),
    ];

    // 1. Fetch all texts in parallel
    const texts = await Promise.all(cards.map((c) => ctx.db.get(c.textId)));

    // 2. Build flat lists of all translation + audio fetches across all cards
    const translationFetches: Array<{ cardIdx: number; lang: string }> = [];
    const translationPromises: Array<Promise<Doc<'translations'> | null>> = [];
    const audioFetches: Array<{ cardIdx: number; lang: string }> = [];
    const audioPromises: Array<Promise<Doc<'audioRecordings'> | null>> = [];

    cards.forEach((card, i) => {
      const text = texts[i];
      if (!text) return;
      for (const lang of allLanguages) {
        if (lang !== text.language) {
          translationFetches.push({ cardIdx: i, lang });
          translationPromises.push(
            ctx.db
              .query('translations')
              .withIndex('by_text_and_language', (q) =>
                q.eq('textId', card.textId).eq('targetLanguage', lang),
              )
              .first(),
          );
        }
        audioFetches.push({ cardIdx: i, lang });
        audioPromises.push(
          ctx.db
            .query('audioRecordings')
            .withIndex('by_text_and_language', (q) =>
              q.eq('textId', card.textId).eq('language', lang),
            )
            .first(),
        );
      }
    });

    // 3. Execute all DB reads in one flat pass
    const [translationResults, audioResults] = await Promise.all([
      Promise.all(translationPromises),
      Promise.all(audioPromises),
    ]);

    // 4. Build lookup maps keyed by "cardIdx:lang"
    const translationMap = new Map<string, Doc<'translations'> | null>();
    translationFetches.forEach((t, i) => {
      translationMap.set(`${t.cardIdx}:${t.lang}`, translationResults[i]);
    });
    const audioMap = new Map<string, Doc<'audioRecordings'> | null>();
    audioFetches.forEach((a, i) => {
      audioMap.set(`${a.cardIdx}:${a.lang}`, audioResults[i]);
    });

    // 5. Fetch storage URLs only for audio that has a storageId
    const audioWithStorage = audioFetches
      .map((a, i) => ({
        key: `${a.cardIdx}:${a.lang}`,
        audio: audioResults[i],
      }))
      .filter(
        (a): a is { key: string; audio: Doc<'audioRecordings'> } =>
          a.audio?.storageId != null,
      );
    const storageUrls = await Promise.all(
      audioWithStorage.map((a) => ctx.storage.getUrl(a.audio.storageId)),
    );
    const urlMap = new Map<string, string | null>();
    audioWithStorage.forEach((a, i) => {
      urlMap.set(a.key, storageUrls[i]);
    });

    // 6. Assemble results synchronously from in-memory maps
    const result = cards.map((card, i) => {
      const text = texts[i];
      if (!text) return null;

      const sourceLanguage = text.language;

      const translations = allLanguages.map((lang) => {
        let translatedText;
        if (lang === sourceLanguage) {
          translatedText = text.text;
        } else {
          translatedText =
            translationMap.get(`${i}:${lang}`)?.translatedText || '';
        }
        return {
          language: lang,
          text: translatedText,
          isBaseLanguage: course.baseLanguages.includes(lang),
          isTargetLanguage: course.targetLanguages.includes(lang),
        };
      });

      const audioRecordings = allLanguages.map((lang) => {
        const key = `${i}:${lang}`;
        const audio = audioMap.get(key);
        return {
          language: lang,
          voiceName: audio?.voiceName ?? null,
          url: urlMap.get(key) ?? null,
        };
      });

      const hasMissingTranslation = translations.some(
        (t) => t.language !== sourceLanguage && !t.text,
      );
      const hasMissingAudio = audioRecordings.some((a) => !a.url);

      return {
        _id: card._id,
        _creationTime: card._creationTime,
        textId: card.textId,
        sourceText: text.text,
        sourceLanguage,
        translations,
        audioRecordings,
        dueDate: card.dueDate,
        isMastered: card.isMastered,
        isHidden: card.isHidden,
        isFavorite: card.isFavorite ?? false,
        hasMissingContent: hasMissingTranslation || hasMissingAudio,
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
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const settings = await getUserSettings(ctx, user._id);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;
    const collections = await ctx.db.query('collections').collect();

    const result = await Promise.all(
      collections.map(async (collection) => {
        const progress = await ctx.db
          .query('collectionProgress')
          .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
            q
              .eq('userId', user._id)
              .eq('courseId', courseId)
              .eq('collectionId', collection._id),
          )
          .first();

        return {
          collectionId: collection._id,
          collectionName: collection.name,
          cardsAdded: progress?.cardsAdded ?? 0,
          totalTexts: collection.textCount,
        };
      }),
    );

    const levelOrder: readonly string[] = LEVEL_ORDER;
    result.sort((a, b) => {
      const aIndex = levelOrder.indexOf(a.collectionName);
      const bIndex = levelOrder.indexOf(b.collectionName);
      if (aIndex === -1 && bIndex === -1)
        return a.collectionName.localeCompare(b.collectionName);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return result;
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
      collectionRank: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const settings = await getUserSettings(ctx, user._id);
    if (!settings?.activeCourseId) return [];

    const courseId = settings.activeCourseId;
    const maxTexts = Math.min(args.limit ?? 5, 20);

    // Get current progress for this collection
    const progress = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
        q
          .eq('userId', user._id)
          .eq('courseId', courseId)
          .eq('collectionId', args.collectionId),
      )
      .first();

    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    const texts = await ctx.db
      .query('texts')
      .withIndex('by_collection_and_rank', (q) =>
        q
          .eq('collectionId', args.collectionId)
          .gt('collectionRank', lastRankProcessed),
      )
      .order('asc')
      .take(maxTexts);

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
    const { user, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

    // Validate collection exists
    const collection = await ctx.db.get(args.collectionId);
    if (!collection) throw new ConvexError('Collection not found');

    // Check if collection is already fully completed
    const progress = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
        q
          .eq('userId', user._id)
          .eq('courseId', courseId)
          .eq('collectionId', args.collectionId),
      )
      .first();

    if (progress && progress.cardsAdded >= collection.textCount) {
      throw new ConvexError('This collection is already complete');
    }

    await setActiveCollectionOnSettings(ctx, courseId, args.collectionId);
    return null;
  },
});

/**
 * Add cards from a collection to the user's deck.
 */
export const addCardsFromCollection = mutation({
  args: {
    collectionId: v.id('collections'),
    batchSize: v.number(),
  },
  returns: v.object({
    cardsAdded: v.number(),
    totalCardsInDeck: v.number(),
  }),
  handler: async (ctx, args) => {
    const { user, settings, course } = await requireActiveCourse(ctx);
    const courseId = course._id;

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

    // Get current progress
    const progress = await ctx.db
      .query('collectionProgress')
      .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
        q
          .eq('userId', user._id)
          .eq('courseId', courseId)
          .eq('collectionId', args.collectionId),
      )
      .first();

    const cardsAlreadyAdded = progress?.cardsAdded ?? 0;
    const lastRankProcessed = progress?.lastRankProcessed ?? 0;

    // Get texts from collection (efficient index range pagination)
    const textsToAdd = await ctx.db
      .query('texts')
      .withIndex('by_collection_and_rank', (q) =>
        q
          .eq('collectionId', args.collectionId)
          .gt('collectionRank', lastRankProcessed),
      )
      .order('asc')
      .take(args.batchSize);

    if (textsToAdd.length === 0) {
      return { cardsAdded: 0, totalCardsInDeck: deck.cardCount };
    }

    let newLastRank = lastRankProcessed;
    const now = Date.now();
    let cardsInserted = 0;

    for (const text of textsToAdd) {
      if (
        text.collectionRank !== undefined &&
        text.collectionRank > newLastRank
      ) {
        newLastRank = text.collectionRank;
      }

      const existingCard = await getCardByDeckAndText(ctx, deck._id, text._id);

      if (!existingCard) {
        await ctx.db.insert('cards', {
          deckId: deck._id,
          textId: text._id,
          collectionId: args.collectionId,
          dueDate: now,
          isMastered: false,
          isHidden: false,
          isFavorite: false,
          schedulingPhase: 'preReview',
          preReviewCount: 0,
        });
        cardsInserted++;
      }
    }

    // Update deck card count
    await ctx.db.patch(deck._id, { cardCount: deck.cardCount + cardsInserted });

    // Update collection progress
    const newCardsAdded = cardsAlreadyAdded + textsToAdd.length;
    if (progress) {
      await ctx.db.patch(progress._id, {
        cardsAdded: newCardsAdded,
        lastRankProcessed: newLastRank,
      });
    } else {
      await ctx.db.insert('collectionProgress', {
        userId: user._id,
        courseId,
        collectionId: args.collectionId,
        cardsAdded: textsToAdd.length,
        lastRankProcessed: newLastRank,
      });
    }

    // Schedule content processing for each card
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

    // Auto-advance: if the collection is now complete and is the active one,
    // move to the next incomplete collection (or clear if last).
    const collection = await ctx.db.get(args.collectionId);
    if (collection && newCardsAdded >= collection.textCount) {
      const courseSettings = await getCourseSettings(ctx, courseId);
      if (
        courseSettings?.activeCollectionId?.toString() ===
        args.collectionId.toString()
      ) {
        // Find next incomplete collection in LEVEL_ORDER
        let nextCollectionId: Id<'collections'> | undefined;
        const nextName = getNextCollectionName(collection.name);

        if (nextName) {
          // Walk forward through LEVEL_ORDER to find the first incomplete collection
          const allCollections = await ctx.db.query('collections').collect();
          const orderedNames: readonly string[] = LEVEL_ORDER;
          const startIdx = orderedNames.indexOf(nextName);

          for (let i = startIdx; i < orderedNames.length; i++) {
            const coll = allCollections.find((c) => c.name === orderedNames[i]);
            if (!coll) continue;

            const prog = await ctx.db
              .query('collectionProgress')
              .withIndex('by_userId_and_courseId_and_collectionId', (q) =>
                q
                  .eq('userId', user._id)
                  .eq('courseId', courseId)
                  .eq('collectionId', coll._id),
              )
              .first();

            if (!prog || prog.cardsAdded < coll.textCount) {
              nextCollectionId = coll._id;
              break;
            }
          }
        }

        await setActiveCollectionOnSettings(ctx, courseId, nextCollectionId);
      }
    }

    return {
      cardsAdded: textsToAdd.length,
      totalCardsInDeck: deck.cardCount + cardsInserted,
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
    const user = await requireAuthUser(ctx);

    const active = await getActiveCourseForUser(ctx, user._id);
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
    if (!text) {
      console.error('Text not found:', args.textId);
      return null;
    }

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
 * Internal action to process translation for a card.
 */
export const processTranslationForCard = internalAction({
  args: {
    textId: v.id('texts'),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const translation = await translateText(
        args.text,
        args.sourceLanguage,
        args.targetLanguage,
      );
      const voiceName = getRandomVoiceForLanguage(args.targetLanguage);

      await ctx.runMutation(
        internal.features.decks.storeTranslationAndScheduleTTS,
        {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          translatedText: translation,
          voiceName,
        },
      );
    } catch (err) {
      console.error('Translation error:', err);
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
      });
    }

    await ctx.scheduler.runAfter(0, internal.features.decks.processTTSForCard, {
      textId: args.textId,
      text: args.translatedText,
      language: args.targetLanguage,
      voiceName: args.voiceName,
    });

    return null;
  },
});

/**
 * Internal action to process TTS for a card.
 */
export const processTTSForCard = internalAction({
  args: {
    textId: v.id('texts'),
    text: v.string(),
    language: v.string(),
    voiceName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const blob = await synthesizeSpeech(args.text, args.voiceName, 0.9);
      const storageId: Id<'_storage'> = await ctx.storage.store(blob);

      await ctx.runMutation(internal.features.decks.storeAudioRecording, {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId,
      });
    } catch (err) {
      console.error('TTS error:', err);
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('audioRecordings')
      .withIndex('by_text_and_language', (q) =>
        q.eq('textId', args.textId).eq('language', args.language),
      )
      .first();

    if (!existing) {
      await ctx.db.insert('audioRecordings', {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId: args.storageId,
      });
    }
    return null;
  },
});

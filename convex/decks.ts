import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent } from "./auth";
import { Id, Doc } from "./_generated/dataModel";
import { 
  getRandomVoiceForLanguage,
  getLocaleFromApiCode,
} from "../lib/languages";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Schedule missing translations and audio for a text.
 * 
 * This helper is used by both `prepareCardContent` (for new cards) and
 * `ensureCardContent` (for on-demand regeneration).
 * 
 * @returns Object with counts of scheduled translations and audio
 */
async function scheduleMissingContent(
  ctx: MutationCtx,
  textId: Id<"texts">,
  text: Doc<"texts">,
  baseLanguages: Array<string>,
  targetLanguages: Array<string>
): Promise<{ translationsScheduled: number; audioScheduled: number }> {
  const sourceLanguage = text.language;
  const allRequiredLanguages = [...new Set([...baseLanguages, ...targetLanguages])];

  // Languages that need translation (all except source)
  const langsNeedingTranslation = allRequiredLanguages.filter((l) => l !== sourceLanguage);

  // Batch load existing translations and audio for only the needed languages
  const [existingTranslations, existingAudio] = await Promise.all([
    Promise.all(
      langsNeedingTranslation.map((lang) =>
        ctx.db
          .query("translations")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("targetLanguage", lang)
          )
          .first()
      )
    ),
    Promise.all(
      allRequiredLanguages.map((lang) =>
        ctx.db
          .query("audioRecordings")
          .withIndex("by_text_and_language", (q) =>
            q.eq("textId", textId).eq("language", lang)
          )
          .first()
      )
    ),
  ]);

  // Build lookup maps for O(1) checks
  const translationMap = new Map(
    langsNeedingTranslation.map((lang, i) => [lang, existingTranslations[i]])
  );
  const audioMap = new Map(
    allRequiredLanguages.map((lang, i) => [lang, existingAudio[i]])
  );

  let translationsScheduled = 0;
  let audioScheduled = 0;

  // Schedule missing content for each required language
  for (const lang of allRequiredLanguages) {
    const hasAudio = audioMap.get(lang) != null;

    if (lang === sourceLanguage) {
      // This language matches the source text, no translation needed
      if (!hasAudio) {
        const voiceName = getRandomVoiceForLanguage(lang);
        await ctx.scheduler.runAfter(0, internal.decks.processTTSForCard, {
          textId,
          text: text.text,
          language: lang,
          voiceName,
        });
        audioScheduled++;
      }
    } else {
      // This language differs from source, need translation
      const translation = translationMap.get(lang);
      if (!translation) {
        // Schedule translation (which will also trigger TTS after completion)
        await ctx.scheduler.runAfter(0, internal.decks.processTranslationForCard, {
          textId,
          sourceLanguage,
          targetLanguage: lang,
          text: text.text,
        });
        translationsScheduled++;
      } else if (!hasAudio) {
        // Translation exists but TTS is missing
        const voiceName = getRandomVoiceForLanguage(lang);
        await ctx.scheduler.runAfter(0, internal.decks.processTTSForCard, {
          textId,
          text: translation.translatedText,
          language: lang,
          voiceName,
        });
        audioScheduled++;
      }
    }
  }

  return { translationsScheduled, audioScheduled };
}

// ============================================================================
// DECK MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Internal mutation to get or create a deck for a course
 */
export const getOrCreateDeck = internalMutation({
  args: {
    courseId: v.id("courses"),
    name: v.string(),
  },
  returns: v.id("decks"),
  handler: async (ctx, args) => {
    // Check if deck already exists for this course
    const existingDeck = await ctx.db
      .query("decks")
      .withIndex("by_courseId", (q) => q.eq("courseId", args.courseId))
      .first();

    if (existingDeck) {
      return existingDeck._id;
    }

    // Create new deck
    const deckId = await ctx.db.insert("decks", {
      courseId: args.courseId,
      name: args.name,
      cardCount: 0, // Initialize card count
    });

    return deckId;
  },
});

/**
 * Get the deck for the user's active course
 */
export const getDeckForCourse = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("decks"),
      _creationTime: v.number(),
      courseId: v.id("courses"),
      name: v.string(),
      cardCount: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return null;
    }

    // Get user's active course
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!settings?.activeCourseId) {
      return null;
    }

    // Get deck for this course
    const deck = await ctx.db
      .query("decks")
      .withIndex("by_courseId", (q) => q.eq("courseId", settings.activeCourseId!))
      .first();

    return deck ?? null;
  },
});

/**
 * Add cards from a collection to the user's deck
 */
export const addCardsFromCollection = mutation({
  args: {
    collectionId: v.id("collections"),
    batchSize: v.number(), // How many cards to add
  },
  returns: v.object({
    cardsAdded: v.number(),
    totalCardsInDeck: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    // Get user's active course
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!settings?.activeCourseId) {
      throw new Error("No active course. Please complete onboarding first.");
    }

    const courseId = settings.activeCourseId;

    // Get the course to check languages
    const course = await ctx.db.get(courseId);
    if (!course) {
      throw new Error("Course not found");
    }

    // Get or create deck for this course
    let deck = await ctx.db
      .query("decks")
      .withIndex("by_courseId", (q) => q.eq("courseId", courseId))
      .first();

    if (!deck) {
      const targetLangs = course.targetLanguages.join(", ");
      const deckId = await ctx.db.insert("decks", {
        courseId,
        name: `Learning ${targetLangs}`,
        cardCount: 0,
      });
      deck = await ctx.db.get(deckId);
      if (!deck) {
        throw new Error("Failed to create deck");
      }
    }

    // Get current progress for this collection
    const progress = await ctx.db
      .query("collectionProgress")
      .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
        q.eq("userId", user._id).eq("courseId", courseId).eq("collectionId", args.collectionId)
      )
      .first();

    const cardsAlreadyAdded = progress?.cardsAdded ?? 0;
    const lastRankProcessed = progress?.lastRankProcessed;

    // Get texts from collection using index range query (efficient pagination)
    // Query texts with rank > lastRankProcessed and take batchSize
    let textsToAdd;
    if (lastRankProcessed !== undefined) {
      // Resume from last processed rank
      textsToAdd = await ctx.db
        .query("texts")
        .withIndex("by_collection_and_rank", (q) =>
          q.eq("collectionId", args.collectionId).gt("collectionRank", lastRankProcessed)
        )
        .order("asc")
        .take(args.batchSize);
    } else {
      // First batch - start from beginning
      textsToAdd = await ctx.db
        .query("texts")
        .withIndex("by_collection_and_rank", (q) =>
          q.eq("collectionId", args.collectionId)
        )
        .order("asc")
        .take(args.batchSize);
    }

    if (textsToAdd.length === 0) {
      // No more texts to add - use denormalized cardCount
      return {
        cardsAdded: 0,
        totalCardsInDeck: deck.cardCount,
      };
    }

    // Track the last rank we process for efficient future queries
    let newLastRank = lastRankProcessed ?? -1;

    // Create cards for each text
    const now = Date.now();
    let cardsInserted = 0;

    for (const text of textsToAdd) {
      // Update the last rank we've seen
      if (text.collectionRank !== undefined && text.collectionRank > newLastRank) {
        newLastRank = text.collectionRank;
      }

      // Check if card already exists for this text in this deck
      const existingCard = await ctx.db
        .query("cards")
        .withIndex("by_deckId_and_textId", (q) =>
          q.eq("deckId", deck._id).eq("textId", text._id)
        )
        .first();

      if (!existingCard) {
        await ctx.db.insert("cards", {
          deckId: deck._id,
          textId: text._id,
          collectionId: args.collectionId,
          dueDate: now, // Due immediately for new cards
          isMastered: false,
          isHidden: false,
        });
        cardsInserted++;
      }
    }

    // Update deck card count (denormalized for efficient queries)
    await ctx.db.patch(deck._id, {
      cardCount: deck.cardCount + cardsInserted,
    });

    // Update collection progress with lastRankProcessed for efficient pagination
    const newCardsAdded = cardsAlreadyAdded + textsToAdd.length;
    if (progress) {
      await ctx.db.patch(progress._id, {
        cardsAdded: newCardsAdded,
        lastRankProcessed: newLastRank,
      });
    } else {
      await ctx.db.insert("collectionProgress", {
        userId: user._id,
        courseId,
        collectionId: args.collectionId,
        cardsAdded: textsToAdd.length,
        lastRankProcessed: newLastRank,
      });
    }

    // Schedule content processing for each card (translations + TTS)
    for (const text of textsToAdd) {
      await ctx.scheduler.runAfter(0, internal.decks.prepareCardContent, {
        textId: text._id,
        baseLanguages: course.baseLanguages,
        targetLanguages: course.targetLanguages,
      });
    }

    return {
      cardsAdded: textsToAdd.length,
      totalCardsInDeck: deck.cardCount + cardsInserted,
    };
  },
});

/**
 * Internal mutation to prepare card content (translations + TTS)
 * 
 * This mutation batch-loads all existing translations and audio for a text,
 * then schedules any missing content generation.
 * 
 * The texts in the database are stored in a source language (usually English).
 * We translate to BOTH the user's base languages AND target languages
 * if they differ from the source text language.
 * 
 * Example: Text stored in English, user has German (base) and Spanish (target)
 * → Translate to German + generate German TTS
 * → Translate to Spanish + generate Spanish TTS
 */
export const prepareCardContent = internalMutation({
  args: {
    textId: v.id("texts"),
    baseLanguages: v.array(v.string()),
    targetLanguages: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const text = await ctx.db.get(args.textId);
    if (!text) {
      console.error("Text not found:", args.textId);
      return null;
    }

    await scheduleMissingContent(
      ctx,
      args.textId,
      text,
      args.baseLanguages,
      args.targetLanguages
    );

    return null;
  },
});

/**
 * Internal action to process translation for a card
 */
export const processTranslationForCard = internalAction({
  args: {
    textId: v.id("texts"),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      console.error("Translation service not configured");
      return null;
    }

    try {
      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: args.text,
            source: args.sourceLanguage,
            target: args.targetLanguage,
            format: "text",
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API error: ${response.status} - ${errorText}`);
      }

      interface GoogleTranslateResponse {
        data: {
          translations: Array<{
            translatedText: string;
          }>;
        };
      }

      const data = (await response.json()) as GoogleTranslateResponse;
      const translation = data.data?.translations?.[0]?.translatedText;

      if (translation) {
        // Store the translation and schedule TTS generation
        const voiceName = getRandomVoiceForLanguage(args.targetLanguage);
        await ctx.runMutation(internal.decks.storeTranslationAndScheduleTTS, {
          textId: args.textId,
          targetLanguage: args.targetLanguage,
          translatedText: translation,
          voiceName,
        });
      }
    } catch (err) {
      console.error("Translation error:", err);
    }

    return null;
  },
});

/**
 * Internal mutation to store a translation and schedule TTS generation
 * Combines two operations into one to reduce action→mutation round trips
 */
export const storeTranslationAndScheduleTTS = internalMutation({
  args: {
    textId: v.id("texts"),
    targetLanguage: v.string(),
    translatedText: v.string(),
    voiceName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Check if translation already exists
    const existing = await ctx.db
      .query("translations")
      .withIndex("by_text_and_language", (q) =>
        q.eq("textId", args.textId).eq("targetLanguage", args.targetLanguage)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("translations", {
        textId: args.textId,
        targetLanguage: args.targetLanguage,
        translatedText: args.translatedText,
      });
    }

    // Schedule TTS generation for the translated text
    await ctx.scheduler.runAfter(0, internal.decks.processTTSForCard, {
      textId: args.textId,
      text: args.translatedText,
      language: args.targetLanguage,
      voiceName: args.voiceName,
    });

    return null;
  },
});

/**
 * Internal action to process TTS for a card
 */
export const processTTSForCard = internalAction({
  args: {
    textId: v.id("texts"),
    text: v.string(),
    language: v.string(), // Base language code (e.g., "en", "de")
    voiceName: v.string(), // Full voice name (e.g., "en-US-Chirp3-HD-Leda")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) {
      console.error("TTS service not configured");
      return null;
    }

    try {
      // Extract locale from voice name for API call
      const languageCode = getLocaleFromApiCode(args.voiceName);

      const requestBody = {
        input: { text: args.text },
        voice: {
          languageCode,
          name: args.voiceName,
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: 0.9,
        },
      };

      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
      }

      interface GoogleTTSResponse {
        audioContent: string;
      }

      const data = (await response.json()) as GoogleTTSResponse;
      const audioContent = data.audioContent;

      if (audioContent) {
        // Store audio in Convex storage
        const blob = new Blob(
          [Uint8Array.from(atob(audioContent), (c) => c.charCodeAt(0))],
          { type: "audio/mp3" }
        );
        const storageId: Id<"_storage"> = await ctx.storage.store(blob);

        await ctx.runMutation(internal.decks.storeAudioRecording, {
          textId: args.textId,
          language: args.language,
          voiceName: args.voiceName,
          storageId,
        });
      }
    } catch (err) {
      console.error("TTS error:", err);
    }

    return null;
  },
});

/**
 * Internal mutation to store an audio recording
 */
export const storeAudioRecording = internalMutation({
  args: {
    textId: v.id("texts"),
    language: v.string(), // Base language code (e.g., "en", "de")
    voiceName: v.string(), // Full voice name (e.g., "en-US-Chirp3-HD-Leda")
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Check if audio already exists for this text and language
    const existing = await ctx.db
      .query("audioRecordings")
      .withIndex("by_text_and_language", (q) =>
        q.eq("textId", args.textId).eq("language", args.language)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("audioRecordings", {
        textId: args.textId,
        language: args.language,
        voiceName: args.voiceName,
        storageId: args.storageId,
      });
    }
    return null;
  },
});

/**
 * Get cards in the user's deck with translations and audio (paginated)
 * 
 * Returns texts in both base and target languages. The source text (usually English)
 * is translated to both the user's base language(s) and target language(s).
 * 
 * Example: Source text in English, user has German (base) and Spanish (target)
 * → Returns: German text (base), Spanish text (target), audio for both
 * 
 * Each card includes a `hasMissingContent` flag. If true, the frontend should call
 * `ensureCardContent` to trigger regeneration.
 * 
 * Uses take() with a reasonable limit instead of collect() to avoid loading all cards.
 */
export const getDeckCards = query({
  args: {
    limit: v.optional(v.number()), // Max cards to return (default 20)
  },
  returns: v.array(
    v.object({
      _id: v.id("cards"),
      _creationTime: v.number(),
      textId: v.id("texts"),
      sourceText: v.string(), // Original text (e.g., English)
      sourceLanguage: v.string(), // Original language (e.g., "en")
      // Translations for ALL course languages (base + target)
      translations: v.array(
        v.object({
          language: v.string(),
          text: v.string(),
          isBaseLanguage: v.boolean(), // true if this is user's base language
          isTargetLanguage: v.boolean(), // true if this is user's target language
        })
      ),
      audioRecordings: v.array(
        v.object({
          language: v.string(), // Base language code (e.g., "en", "de")
          voiceName: v.union(v.string(), v.null()), // Full voice name used
          url: v.union(v.string(), v.null()), // Generated from storageId
        })
      ),
      dueDate: v.number(),
      isMastered: v.boolean(),
      isHidden: v.boolean(),
      hasMissingContent: v.boolean(), // true if translations or audio are missing
    })
  ),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    // Get user's active course
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!settings?.activeCourseId) {
      return [];
    }

    // Get the course
    const course = await ctx.db.get(settings.activeCourseId);
    if (!course) {
      return [];
    }

    // Get deck for this course
    const deck = await ctx.db
      .query("decks")
      .withIndex("by_courseId", (q) => q.eq("courseId", settings.activeCourseId!))
      .first();

    if (!deck) {
      return [];
    }

    // Get cards in deck with a reasonable limit (avoid collect on large tables)
    const maxCards = args.limit ?? 20;
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_deckId", (q) => q.eq("deckId", deck._id))
      .take(maxCards);

    // All languages we need content for (both base and target)
    const allLanguages = [...new Set([...course.baseLanguages, ...course.targetLanguages])];

    // Build full card objects
    const result = await Promise.all(
      cards.map(async (card) => {
        // Get the source text (usually English)
        const text = await ctx.db.get(card.textId);
        if (!text) {
          return null;
        }

        const sourceLanguage = text.language;

        // Get translations for ALL course languages (both base and target)
        const translations = await Promise.all(
          allLanguages.map(async (lang) => {
            let translatedText = "";

            if (lang === sourceLanguage) {
              // This language matches the source, use the original text
              translatedText = text.text;
            } else {
              // Fetch the translation
              const translation = await ctx.db
                .query("translations")
                .withIndex("by_text_and_language", (q) =>
                  q.eq("textId", card.textId).eq("targetLanguage", lang)
                )
                .first();
              translatedText = translation?.translatedText || "";
            }

            return {
              language: lang,
              text: translatedText,
              isBaseLanguage: course.baseLanguages.includes(lang),
              isTargetLanguage: course.targetLanguages.includes(lang),
            };
          })
        );

        // Get audio for all languages (query by base language code)
        const audioRecordings = await Promise.all(
          allLanguages.map(async (lang) => {
            const audio = await ctx.db
              .query("audioRecordings")
              .withIndex("by_text_and_language", (q) =>
                q.eq("textId", card.textId).eq("language", lang)
              )
              .first();

            // Generate URL from storage on the fly
            const url = audio?.storageId
              ? await ctx.storage.getUrl(audio.storageId)
              : null;

            return {
              language: lang,
              voiceName: audio?.voiceName ?? null,
              url,
            };
          })
        );

        // Check if any content is missing
        const hasMissingTranslation = translations.some(
          (t) => t.language !== sourceLanguage && !t.text
        );
        const hasMissingAudio = audioRecordings.some((a) => !a.url);
        const hasMissingContent = hasMissingTranslation || hasMissingAudio;

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
          hasMissingContent,
        };
      })
    );

    // Filter out nulls
    return result.filter((card): card is NonNullable<typeof card> => card !== null);
  },
});

/**
 * Get collection progress for all collections in the active course
 */
export const getCollectionProgress = query({
  args: {},
  returns: v.array(
    v.object({
      collectionId: v.id("collections"),
      collectionName: v.string(),
      cardsAdded: v.number(),
      totalTexts: v.number(),
    })
  ),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    // Get user's active course
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!settings?.activeCourseId) {
      return [];
    }

    const courseId = settings.activeCourseId;

    // Get all collections
    const collections = await ctx.db.query("collections").collect();

    // Get progress for each collection
    const result = await Promise.all(
      collections.map(async (collection) => {
        const progress = await ctx.db
          .query("collectionProgress")
          .withIndex("by_userId_and_courseId_and_collectionId", (q) =>
            q
              .eq("userId", user._id)
              .eq("courseId", courseId)
              .eq("collectionId", collection._id)
          )
          .first();

        return {
          collectionId: collection._id,
          collectionName: collection.name,
          cardsAdded: progress?.cardsAdded ?? 0,
          totalTexts: collection.textCount,
        };
      })
    );

    // Sort by CEFR level order
    const levelOrder = ["Essential", "A1", "A2", "B1", "B2", "C1", "C2"];
    result.sort((a, b) => {
      const aIndex = levelOrder.indexOf(a.collectionName);
      const bIndex = levelOrder.indexOf(b.collectionName);
      if (aIndex === -1 && bIndex === -1) return a.collectionName.localeCompare(b.collectionName);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return result;
  },
});

/**
 * Ensure content (translations + audio) exists for a specific card.
 * Called automatically when a card is displayed and has missing content.
 */
export const ensureCardContent = mutation({
  args: {
    textId: v.id("texts"),
  },
  returns: v.object({
    translationsScheduled: v.number(),
    audioScheduled: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    // Get user's active course
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!settings?.activeCourseId) {
      return { translationsScheduled: 0, audioScheduled: 0 };
    }

    // Get the course
    const course = await ctx.db.get(settings.activeCourseId);
    if (!course) {
      return { translationsScheduled: 0, audioScheduled: 0 };
    }

    // Get the source text
    const text = await ctx.db.get(args.textId);
    if (!text) {
      return { translationsScheduled: 0, audioScheduled: 0 };
    }

    return scheduleMissingContent(
      ctx,
      args.textId,
      text,
      course.baseLanguages,
      course.targetLanguages
    );
  },
});


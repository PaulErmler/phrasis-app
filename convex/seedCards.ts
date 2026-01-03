/** */
import { mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { essentialSentences } from "./essentialSentences";

/**
 * Add essential sentence cards from Essential.csv for a user with pre-generated audio
 * Adds the NEXT N sentences that the user doesn't already have cards for
 */
export const addBasicCards: any = action({
  args: { userId: v.string(), count: v.optional(v.number()), sourceLanguage: v.optional(v.string()), targetLanguage: v.optional(v.string()) },
  handler: async (ctx, { userId, count = 10, sourceLanguage = "en", targetLanguage = "es" }): Promise<{ message: string; cardIds: any[] }> => {
    // 1. Get all existing sentence texts that user already has cards for
    const existingCards = await ctx.runQuery(api.cardActions.getAllCardsForPractice, { userId, limit: 1000 });
    const existingSentenceTexts = new Set(existingCards.map((card: any) => card.sourceText || card.english));

    // 2. Find the next N sentences the user doesn't have yet
    const sentencesToAdd: string[] = [];
    for (const sentence of essentialSentences) {
      if (!existingSentenceTexts.has(sentence)) {
        sentencesToAdd.push(sentence);
        if (sentencesToAdd.length >= count) break;
      }
    }

    if (sentencesToAdd.length === 0) {
      return {
        message: "You already have all available essential sentences!",
        cardIds: [],
      };
    }

    // 3. Translate ALL sentences in parallel first
    const translationPromises = sentencesToAdd.map((sourceText) =>
      ctx.runAction(api.translation.translateText, {
        text: sourceText,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
      }).catch((error) => {
        console.error(`Failed to translate "${sourceText}":`, error);
        return { translatedText: sourceText }; // fallback
      })
    );

    const translations = await Promise.all(translationPromises);

    // 4. Create all cards in the database SEQUENTIALLY to avoid conflicts
    const results: Array<{ cardId: any; sourceText: string }> = [];
    for (let i = 0; i < sentencesToAdd.length; i++) {
      const sourceText = sentencesToAdd[i];
      const targetText = translations[i].translatedText;
      
      const cardId = await ctx.runMutation(api.seedCards.createCardWithTranslation, {
        userId,
        sourceText,
        targetText,
        sourceLanguage,
        targetLanguage,
      });
      
      if (cardId) {
        results.push({ cardId, sourceText });
      }
    }

    // 5. Pre-generate audio for ALL cards in parallel
    const audioPromises = sentencesToAdd.map((sourceText) =>
      ctx.runAction(api.audioFunctions.getOrRecordAudio, {
        text: sourceText,
        language: sourceLanguage,
      }).catch((error) => {
        console.error(`Error pre-generating audio for "${sourceText}":`, error);
      })
    );

    await Promise.all(audioPromises);

    return {
      message: `Added ${results.length} new cards with audio`,
      cardIds: results.map((r) => r.cardId),
    };
  },
});

/**
 * Helper mutation to create a card with translation
 */
export const createCardWithTranslation = mutation({
  args: {
    userId: v.string(),
    sourceText: v.string(),
    targetText: v.string(),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()), // Default to 'es' for backward compatibility
  },
  handler: async (ctx, { userId, sourceText, targetText, sourceLanguage = "en", targetLanguage = "es" }) => {
    // 1. Check if source sentence already exists
    let sentenceRecord = await ctx.db
      .query("sentences")
      .withIndex("by_text", (q) => q.eq("text", sourceText))
      .first();

    // 2. If not, insert it
    if (!sentenceRecord) {
      const sentenceId = await ctx.db.insert("sentences", {
        text: sourceText,
        language: sourceLanguage,
      });
      sentenceRecord = await ctx.db.get(sentenceId);
    }

    if (!sentenceRecord) return null;

    // 3. Check if target translation exists
    let translation = await ctx.db
      .query("translations")
      .withIndex("by_sentence_and_language", (q) =>
        q.eq("sentenceId", sentenceRecord._id).eq("targetLanguage", targetLanguage)
      )
      .first();

    // 4. If not, insert translation
    if (!translation) {
      await ctx.db.insert("translations", {
        sentenceId: sentenceRecord._id,
        targetLanguage: targetLanguage,
        translatedText: targetText,
      });
    }

    // 5. Create a card for the user (if it doesn't already exist)
    const existingCard = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("sentenceId"), sentenceRecord._id),
          q.eq(q.field("targetLanguage"), targetLanguage)
        )
      )
      .first();

    if (existingCard) {
      return existingCard._id;
    }

    // Create the card
    const cardId = await ctx.db.insert("cards", {
      userId,
      sentenceId: sentenceRecord._id,
      targetLanguage, // Add target language to card
      // FSRS initial state for new card
      state: "new",
      difficulty: 0,
      stability: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      nextReview: Date.now(), // Due immediately
      initialLearningPhase: true,
      initialReviewCount: 0,
    });

    return cardId;
  },
});

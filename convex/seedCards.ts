/** */
import { mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { essentialSentences } from "./essentialSentences";

/**
 * Add all essential sentence cards from Essential.csv for a user with pre-generated audio
 */
export const addBasicCards: any = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<{ message: string; cardIds: any[] }> => {
    // 1. Translate ALL sentences in parallel first
    const translationPromises = essentialSentences.map((english) =>
      ctx.runAction(api.translation.translateText, {
        text: english,
        sourceLang: "en",
        targetLang: "es",
      }).catch((error) => {
        console.error(`Failed to translate "${english}":`, error);
        return { translatedText: english }; // fallback
      })
    );

    const translations = await Promise.all(translationPromises);

    // 2. Create all cards in the database
    const results: Array<{ cardId: any; english: string }> = [];
    const cardPromises = essentialSentences.map((english, index) =>
      ctx.runMutation(api.seedCards.createCardWithTranslation, {
        userId,
        english,
        spanish: translations[index].translatedText,
      }).then((cardId) => {
        if (cardId) {
          results.push({ cardId, english });
        }
        return cardId;
      })
    );

    await Promise.all(cardPromises);

    // 3. Pre-generate audio for ALL cards in parallel
    const audioPromises = essentialSentences.map((english) =>
      ctx.runAction(api.audioFunctions.getOrRecordAudio, {
        text: english,
        language: "en",
      }).catch((error) => {
        console.error(`Error pre-generating audio for "${english}":`, error);
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
    english: v.string(),
    spanish: v.string(),
  },
  handler: async (ctx, { userId, english, spanish }) => {
    // 1. Check if English sentence already exists
    let sentenceRecord = await ctx.db
      .query("sentences")
      .withIndex("by_text", (q) => q.eq("text", english))
      .first();

    // 2. If not, insert it
    if (!sentenceRecord) {
      const sentenceId = await ctx.db.insert("sentences", {
        text: english,
        language: "en",
        createdAt: Date.now(),
      });
      sentenceRecord = await ctx.db.get(sentenceId);
    }

    if (!sentenceRecord) return null;

    // 3. Check if Spanish translation exists
    let translation = await ctx.db
      .query("translations")
      .withIndex("by_sentence_and_language", (q) =>
        q.eq("sentenceId", sentenceRecord._id).eq("targetLanguage", "es")
      )
      .first();

    // 4. If not, insert translation
    if (!translation) {
      await ctx.db.insert("translations", {
        sentenceId: sentenceRecord._id,
        targetLanguage: "es",
        translatedText: spanish,
        createdAt: Date.now(),
      });
    }

    // 5. Create a card for the user (if it doesn't already exist)
    const existingCard = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("sentenceId"), sentenceRecord._id)
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
      // FSRS initial state for new card
      state: "new",
      difficulty: 0,
      stability: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      nextReview: Date.now(), // Due immediately
      createdAt: Date.now(),
    });

    return cardId;
  },
});

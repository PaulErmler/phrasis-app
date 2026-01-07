/** */
import { mutation, action, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { parseCSVFromStorage, getNewSentences as filterNewSentences } from "./csvParser";

/**
 * Import sentence cards from any dataset for a user with pre-generated audio
 * Adds the NEXT N sentences that the user doesn't already have cards for
 * Reads all columns from CSV (id, text, difficulty, rank, topics, etc.)
 */
export const importCardsFromDataset = action({
  args: { userId: v.string(), count: v.optional(v.number()), sourceLanguage: v.string(), targetLanguage: v.string(), dataset: v.optional(v.string()), difficulty: v.optional(v.string()), datasetSentenceId: v.optional(v.number()), deck: v.optional(v.string()), deckRank: v.optional(v.number()), topic1: v.optional(v.string()), topic2: v.optional(v.string()) },
  handler: async (ctx, { userId, count = 10, sourceLanguage = "en", targetLanguage, dataset = "Essential" }): Promise<{ message: string; cardIds: any[] }> => {
    // Use provided targetLanguage or default to "es"
    const finalTargetLanguage = targetLanguage || "es";
    
    // 1. Get all existing sentence texts that user already has cards for
    const existingCards = await ctx.runQuery(api.cardActions.getAllCardsForPractice, { userId, limit: 1000 });
    const existingSentenceTexts = new Set<string>(existingCards.map((card: any) => card.sourceText || card.english));

    // 2. Parse CSV from Convex storage and get new sentences
    const allSentences = await parseCSVFromStorage(ctx, dataset);
    
    if (allSentences.length === 0) {
      return {
        message: `No sentences found in storage. Please upload the ${dataset} dataset first.`,
        cardIds: [],
      };
    }

    const sentencesToAdd = filterNewSentences(allSentences, existingSentenceTexts, count);

    if (sentencesToAdd.length === 0) {
      return {
        message: `You already have all available sentences from the ${dataset} dataset!`,
        cardIds: [],
      };
    }

    // 3. Create sentences and cards immediately (non-blocking)
    // Schedule translation and audio requests in background
    const results: Array<{ cardId: any; sourceText: string }> = [];
    
    for (const sentence of sentencesToAdd) {
      // Check if sentence already exists
      let sentenceRecord = await ctx.runQuery(api.cardImporter.getSentenceByText, { text: sentence.text });

      // Create sentence if it doesn't exist
      if (!sentenceRecord) {
        const sentenceId = await ctx.runMutation(api.sentences.createSentence, {
          datasetSentenceId: sentence.datasetSentenceId,
          text: sentence.text,
          language: sourceLanguage,
          deck: sentence.deck,
          deckRank: sentence.deckRank,
          difficulty: sentence.difficulty,
          topic1: sentence.topic1,
          topic2: sentence.topic2,
        });
        sentenceRecord = await ctx.runQuery(api.sentences.getSentenceById, { sentenceId });
      }

      if (!sentenceRecord) {
        continue;
      }

      // Create card immediately
      const cardId = await ctx.runMutation(api.cardImporter.createCardForSentence, {
        userId,
        sentenceId: sentenceRecord._id,
        targetLanguage: finalTargetLanguage,
      });

      if (cardId) {
        results.push({ cardId, sourceText: sentence.text });
      }

      // Schedule translation request in background (don't wait)
      ctx.scheduler.runAfter(0, api.translationRequests.translateInBackground, {
        requestId: "temp", // Not used, just for schedule
        sourceText: sentence.text,
        sourceLanguage,
        targetLanguage: finalTargetLanguage,
      });

      // Schedule audio request in background (don't wait)
      ctx.scheduler.runAfter(0, api.audioRequests.generateAudio, {
        requestId: "temp", // Not used, just for schedule
        text: sentence.text,
        language: sourceLanguage,
        difficulty: sentence.difficulty,
        datasetSentenceId: sentence.datasetSentenceId,
        deck: sentence.deck,
        deckRank: sentence.deckRank,
        topic1: sentence.topic1,
        topic2: sentence.topic2,
      });
    }

    return {
      message: `Added ${results.length} new cards. Translations and audio are generating in the background.`,
      cardIds: results.map((r) => r.cardId),
    };
  },
});

/**
 * Get a sentence by its text
 */
export const getSentenceByText = query({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    return await ctx.db
      .query("sentences")
      .filter((q) => q.eq(q.field("text"), text))
      .first();
  },
});

/**
 * Create a card for a sentence (simple, non-blocking)
 */
export const createCardForSentence = mutation({
  args: {
    userId: v.string(),
    sentenceId: v.id("sentences"),
    targetLanguage: v.string(),
  },
  handler: async (ctx, { userId, sentenceId, targetLanguage }) => {
    // Check if card already exists
    const existing = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), userId),
          q.eq(q.field("sentenceId"), sentenceId),
          q.eq(q.field("targetLanguage"), targetLanguage)
        )
      )
      .first();

    if (existing) {
      return existing._id;
    }

    // Create new card
    return await ctx.db.insert("cards", {
      userId,
      sentenceId,
      targetLanguage,
      state: "new",
      difficulty: 0,
      stability: 0,
      elapsedDays: 0,
      scheduledDays: 0,
      reps: 0,
      lapses: 0,
      nextReview: Date.now(),
      initialLearningPhase: true,
      initialReviewCount: 0,
    });
  },
});

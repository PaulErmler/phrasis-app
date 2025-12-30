import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { initializeCard, rateCard, FSRSCardData, ReviewRating } from "./fsrs";
import { api } from "./_generated/api";

type CardState = "new" | "learning" | "review" | "relearning";

/**
 * Get all cards due for review for the current user, sorted by due date
 */
export const getCardsDueForReview = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit = 20 }) => {
    const now = Date.now();
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_userId_nextReview", (q) =>
        q.eq("userId", userId).lte("nextReview", now)
      )
      .order("asc")
      .take(limit);

    // Enrich with sentence data
    const enriched = await Promise.all(
      cards.map(async (card) => {
        const sentence = await ctx.db.get(card.sentenceId);
        const translation = await ctx.db
          .query("translations")
          .withIndex("by_sentence_and_language", (q) =>
            q.eq("sentenceId", card.sentenceId).eq("targetLanguage", "es")
          )
          .first();

        return {
          ...card,
          english: sentence?.text || "",
          spanish: translation?.translatedText || "",
        };
      })
    );

    return enriched;
  },
});

/**
 * Get all cards for practice (ignoring due date) - for when user wants to review anyway
 */
export const getAllCardsForPractice = query({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit = 20 }) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    // Enrich with sentence data
    const enriched = await Promise.all(
      cards.map(async (card) => {
        const sentence = await ctx.db.get(card.sentenceId);
        const translation = await ctx.db
          .query("translations")
          .withIndex("by_sentence_and_language", (q) =>
            q.eq("sentenceId", card.sentenceId).eq("targetLanguage", "es")
          )
          .first();

        return {
          ...card,
          english: sentence?.text || "",
          spanish: translation?.translatedText || "",
        };
      })
    );

    return enriched;
  },
});

/**
 * Get card stats for user dashboard
 */
export const getCardStats = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const cards = await ctx.db
      .query("cards")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const now = Date.now();
    const dueCount = cards.filter((c) => (c.nextReview ?? 0) <= now).length;
    const newCount = cards.filter((c) => c.state === "new").length;
    const reviewCount = cards.filter((c) => c.state === "review").length;
    const learningCount = cards.filter((c) => c.state === "learning").length;

    const reviews = await ctx.db
      .query("card_reviews")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const reviewsToday = reviews.filter(
      (r) => r.reviewedAt > Date.now() - 24 * 60 * 60 * 1000
    ).length;

    return {
      totalCards: cards.length,
      dueCount,
      newCount,
      reviewCount,
      learningCount,
      reviewsToday,
      totalReviews: reviews.length,
    };
  },
});

/**
 * Create a new card for a sentence
 */
export const createCard = mutation({
  args: {
    userId: v.string(),
    sentenceId: v.id("sentences"),
  },
  handler: async (ctx, { userId, sentenceId }) => {
    // Check if card already exists
    const existing = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(q.eq(q.field("userId"), userId), q.eq(q.field("sentenceId"), sentenceId))
      )
      .first();

    if (existing) {
      return existing;
    }

    const fsrsData = initializeCard();
    const cardId = await ctx.db.insert("cards", {
      userId,
      sentenceId,
      ...fsrsData,
      nextReview: Date.now(), // New cards are due immediately
      createdAt: Date.now(),
    });

    return { _id: cardId, ...fsrsData };
  },
});

/**
 * Create a card from a user-created sentence
 */
export const createCardFromUserSentence = mutation({
  args: {
    userId: v.string(),
    userSentenceId: v.id("user_sentences"),
  },
  handler: async (ctx, { userId, userSentenceId }) => {
    const fsrsData = initializeCard();
    const cardId = await ctx.db.insert("cards", {
      userId,
      sentenceId: userSentenceId as any, // Temporarily store user sentence ID
      ...fsrsData,
      nextReview: Date.now(),
      createdAt: Date.now(),
    });

    return { _id: cardId, ...fsrsData };
  },
});

/**
 * Rate a card and update its FSRS state
 */
export const rateCardReview = mutation({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
    sentenceId: v.id("sentences"),
    rating: v.union(v.literal("again"), v.literal("hard"), v.literal("good"), v.literal("easy")),
    elapsedSeconds: v.number(),
  },
  handler: async (ctx, { userId, cardId, sentenceId, rating, elapsedSeconds }) => {
    const card = await ctx.db.get(cardId);
    if (!card || card.userId !== userId) {
      throw new Error("Card not found or unauthorized");
    }

    // Calculate new FSRS state - convert state from number to CardState
    const cardData: FSRSCardData = {
      state: (["new", "learning", "review", "relearning"][(card.state as unknown) as number] || "new") as CardState,
      difficulty: card.difficulty,
      stability: card.stability,
      elapsedDays: card.elapsedDays,
      scheduledDays: card.scheduledDays,
      reps: card.reps,
      lapses: card.lapses,
      lastReview: card.lastReview,
      nextReview: card.nextReview,
    };

    const { updatedCard, nextReviewMs } = rateCard(
      cardData,
      rating as ReviewRating,
      Date.now()
    );

    // Update card
    await ctx.db.patch(cardId, {
      ...updatedCard,
      nextReview: nextReviewMs,
    });

    // Log review
    await ctx.db.insert("card_reviews", {
      userId,
      cardId,
      sentenceId,
      rating,
      elapsedSeconds,
      reviewedAt: Date.now(),
    });

    return updatedCard;
  },
});

/**
 * Get review history for a card
 */
export const getCardReviewHistory = query({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const reviews = await ctx.db
      .query("card_reviews")
      .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
      .order("desc")
      .take(50);

    return reviews;
  },
});

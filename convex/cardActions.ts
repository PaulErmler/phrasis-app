import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { initializeCard, rateCard, FSRSCardData, ReviewRating } from "./fsrs";
import { api } from "./_generated/api";

type CardState = "new" | "learning" | "review" | "relearning";

/**
 * Calculate priority score for initial learning cards
 * Higher score = should be reviewed sooner
 * Score = (reviewsRequired - currentCount) * reviewCountWeight + (minutesSinceLast) * minutesWeight
 */
function calculateInitialLearningPriority(
  initialReviewCount: number,
  lastInitialReviewTime: number | undefined,
  reviewsRequired: number,
  reviewCountCoeff: number,
  minutesCoeff: number,
  now: number
): number {
  const reviewsRemaining = Math.max(0, reviewsRequired - initialReviewCount);
  const minutesSinceLast = lastInitialReviewTime
    ? (now - lastInitialReviewTime) / (1000 * 60)
    : 0;
  return reviewsRemaining * reviewCountCoeff + minutesSinceLast * minutesCoeff;
}

/**
 * Get all cards due for review (both initial learning and FSRS)
 * Initial learning cards are shown FIRST and ONLY - FSRS blocked until all initial learning complete
 */
export const getCardsDueForReview = query({
  args: { userId: v.string(), limit: v.optional(v.number()), targetLanguage: v.optional(v.string()) },
  handler: async (ctx, { userId, limit = 20, targetLanguage: paramTargetLanguage }) => {
    const now = Date.now();

    // Get user preferences for initial learning config and target language
    const prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // Use parameter if provided, otherwise fall back to user preferences
    const targetLanguage = paramTargetLanguage ?? prefs?.targetLanguage ?? "es";
    const reviewsRequired = prefs?.initialLearningReviewsRequired ?? 4;
    const reviewCountCoeff = prefs?.initialLearningPriorityCoefficientReviewCount ?? 1.0;
    const minutesCoeff = prefs?.initialLearningPriorityCoefficientMinutes ?? 0.1;

    // Get initial learning cards for the current target language
    const initialLearningCards = await ctx.db
      .query("cards")
      .withIndex("by_userId_targetLanguage_initialLearning", (q) =>
        q.eq("userId", userId).eq("targetLanguage", targetLanguage).eq("initialLearningPhase", true)
      )
      .collect();

    // Filter out cards that already meet the graduation requirement
    const activeInitialLearningCards = initialLearningCards.filter(
      (card) => card.initialReviewCount < reviewsRequired
    );

    // Sort initial learning cards by priority
    const sortedInitialLearning = activeInitialLearningCards.sort((a, b) => {
      const priorityA = calculateInitialLearningPriority(
        a.initialReviewCount,
        a.lastInitialReviewTime,
        reviewsRequired,
        reviewCountCoeff,
        minutesCoeff,
        now
      );
      const priorityB = calculateInitialLearningPriority(
        b.initialReviewCount,
        b.lastInitialReviewTime,
        reviewsRequired,
        reviewCountCoeff,
        minutesCoeff,
        now
      );
      return priorityB - priorityA; // Higher priority first
    });

    // If ANY initial learning cards exist for this language, ONLY show those
    let allCards;
    if (sortedInitialLearning.length > 0) {
      allCards = sortedInitialLearning.slice(0, limit);
    } else {
      // No initial learning cards - get FSRS cards due for review in target language
      const fsrsCards = await ctx.db
        .query("cards")
        .withIndex("by_userId_targetLanguage_nextReview", (q) =>
          q.eq("userId", userId).eq("targetLanguage", targetLanguage).lte("nextReview", now)
        )
        .filter((q) => q.eq(q.field("initialLearningPhase"), false))
        .order("asc")
        .collect();
      allCards = fsrsCards.slice(0, limit);
    }

    // Enrich with sentence data
    const enriched = await Promise.all(
      allCards.map(async (card) => {
        const sentence = await ctx.db.get(card.sentenceId);
        const translation = await ctx.db
          .query("translations")
          .withIndex("by_sentence_and_language", (q) =>
            q.eq("sentenceId", card.sentenceId).eq("targetLanguage", prefs?.targetLanguage ?? "es")
          )
          .first();

        return {
          ...card,
          sourceText: sentence?.text || "",
          targetText: translation?.translatedText || "",
          sourceLanguage: sentence?.language || prefs?.sourceLanguage || "en",
          targetLanguage: prefs?.targetLanguage ?? "es",
          isInInitialLearning: card.initialLearningPhase,
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
    const prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const targetLanguage = prefs?.targetLanguage ?? "es";

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_userId_targetLanguage", (q) => 
        q.eq("userId", userId).eq("targetLanguage", targetLanguage)
      )
      .order("desc")
      .take(limit);

    // Enrich with sentence data
    const enriched = await Promise.all(
      cards.map(async (card) => {
        const sentence = await ctx.db.get(card.sentenceId);
        const translation = await ctx.db
          .query("translations")
          .withIndex("by_sentence_and_language", (q) =>
            q.eq("sentenceId", card.sentenceId).eq("targetLanguage", prefs?.targetLanguage ?? "es")
          )
          .first();

        return {
          ...card,
          sourceText: sentence?.text || "",
          targetText: translation?.translatedText || "",
          sourceLanguage: sentence?.language || prefs?.sourceLanguage || "en",
          targetLanguage: prefs?.targetLanguage ?? "es",
          isInInitialLearning: card.initialLearningPhase,
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
  args: { userId: v.string(), targetLanguage: v.optional(v.string()) },
  handler: async (ctx, { userId, targetLanguage: paramTargetLanguage }) => {
    // Get user preferences for target language
    const prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // Use parameter if provided, otherwise fall back to user preferences
    const targetLanguage = paramTargetLanguage ?? prefs?.targetLanguage ?? "es";

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_userId_targetLanguage", (q) => 
        q.eq("userId", userId).eq("targetLanguage", targetLanguage)
      )
      .collect();

    const now = Date.now();
    const initialLearningCards = cards.filter((c) => c.initialLearningPhase);
    const fsrsCards = cards.filter((c) => !c.initialLearningPhase);

    // Initial learning stats
    const initialLearningDueNow = initialLearningCards.length; // All initial learning cards are "due"
    const initialLearningCount = initialLearningCards.length;

    // FSRS stats
    const dueCount = fsrsCards.filter((c) => (c.nextReview ?? 0) <= now).length;
    const newCount = fsrsCards.filter((c) => c.state === "new").length;
    const reviewCount = fsrsCards.filter((c) => c.state === "review").length;
    const learningCount = fsrsCards.filter((c) => c.state === "learning").length;

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
      initialLearningCount,
      initialLearningDueNow,
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
    targetLanguage: v.string(), // Language being learned
  },
  handler: async (ctx, { userId, sentenceId, targetLanguage }) => {
    // Check if card already exists for this user, sentence, and target language
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
      return existing;
    }

    const fsrsData = initializeCard();
    const cardId = await ctx.db.insert("cards", {
      userId,
      sentenceId,
      targetLanguage,
      ...fsrsData,
      nextReview: Date.now(), // New cards are due immediately
      initialLearningPhase: true,
      initialReviewCount: 0,
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
    targetLanguage: v.string(),
  },
  handler: async (ctx, { userId, userSentenceId, targetLanguage }) => {
    const fsrsData = initializeCard();
    const cardId = await ctx.db.insert("cards", {
      userId,
      sentenceId: userSentenceId as any,
      targetLanguage,
      ...fsrsData,
      nextReview: Date.now(),

      initialLearningPhase: true,
      initialReviewCount: 0,
    });

    return { _id: cardId, ...fsrsData };
  },
});

/**
 * Mark a card as seen in initial learning phase
 * Increments review count; when reaching required count, initializes FSRS and moves to FSRS phase
 */
export const markCardAsSeenInInitialLearning = mutation({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
  },
  handler: async (ctx, { userId, cardId }) => {
    const card = await ctx.db.get(cardId);
    if (!card || card.userId !== userId) {
      throw new Error("Card not found or unauthorized");
    }

    if (!card.initialLearningPhase) {
      throw new Error("Card is not in initial learning phase");
    }

    // Get user preferences to know when to graduate
    const prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const reviewsRequired = prefs?.initialLearningReviewsRequired ?? 4;
    
    // Check if card already meets graduation requirement (e.g., requirement was lowered)
    if (card.initialReviewCount >= reviewsRequired) {
      // Graduate immediately without incrementing
      const fsrsData = initializeCard();
      await ctx.db.patch(cardId, {
        initialLearningPhase: false,
        lastInitialReviewTime: Date.now(),
        ...fsrsData,
        nextReview: Date.now(), // FSRS cards start due immediately
      });
      return { success: true, graduated: true };
    }
    
    const newReviewCount = card.initialReviewCount + 1;

    if (newReviewCount >= reviewsRequired) {
      // Graduate to FSRS
      const fsrsData = initializeCard();
      await ctx.db.patch(cardId, {
        initialLearningPhase: false,
        initialReviewCount: newReviewCount,
        lastInitialReviewTime: Date.now(),
        ...fsrsData,
        nextReview: Date.now(), // FSRS cards start due immediately
      });
    } else {
      // Stay in initial learning, just increment count
      await ctx.db.patch(cardId, {
        initialReviewCount: newReviewCount,
        lastInitialReviewTime: Date.now(),
      });
    }

    return { success: true, graduated: newReviewCount >= reviewsRequired };
  },
});

/**
 * Skip initial learning phase - graduate all initial learning cards to FSRS immediately
 */
export const skipInitialLearningPhase = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const initialLearningCards = await ctx.db
      .query("cards")
      .withIndex("by_userId_initialLearning", (q) =>
        q.eq("userId", userId).eq("initialLearningPhase", true)
      )
      .collect();

    const now = Date.now();
    let graduatedCount = 0;

    for (const card of initialLearningCards) {
      const fsrsData = initializeCard();
      await ctx.db.patch(card._id, {
        initialLearningPhase: false,
        lastInitialReviewTime: now,
        ...fsrsData,
        nextReview: now, // Due immediately for FSRS
      });
      graduatedCount++;
    }

    return { success: true, graduatedCount };
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
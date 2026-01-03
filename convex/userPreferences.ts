import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get user preferences, with defaults if not set
 */
export const getUserPreferences = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    let prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!prefs) {
      // Return defaults
      return {
        userId,
        sourceLanguage: "en", // Default: English
        targetLanguage: "es", // Default: Spanish
        autoplayDelaySourceToTarget: 2000,
        autoplayDelayTargetToNext: 3000,
        maxInitialLearningCards: 10,
        initialLearningReviewsRequired: 4,
        initialLearningPriorityCoefficientReviewCount: 1.0,
        initialLearningPriorityCoefficientMinutes: 0.1,
        initialLearningAutoplay: false,
        updatedAt: Date.now(),
      };
    }

    return prefs;
  },
});

/**
 * Update user preferences
 */
export const updateUserPreferences = mutation({
  args: {
    userId: v.string(),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
    autoplayDelaySourceToTarget: v.optional(v.number()),
    autoplayDelayTargetToNext: v.optional(v.number()),
    maxInitialLearningCards: v.optional(v.number()),
    initialLearningReviewsRequired: v.optional(v.number()),
    initialLearningPriorityCoefficientReviewCount: v.optional(v.number()),
    initialLearningPriorityCoefficientMinutes: v.optional(v.number()),
    initialLearningAutoplay: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      userId,
      sourceLanguage,
      targetLanguage,
      autoplayDelaySourceToTarget,
      autoplayDelayTargetToNext,
      maxInitialLearningCards,
      initialLearningReviewsRequired,
      initialLearningPriorityCoefficientReviewCount,
      initialLearningPriorityCoefficientMinutes,
      initialLearningAutoplay,
    }
  ) => {
    let prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const updates = {
      userId,
      updatedAt: Date.now(),
      ...(sourceLanguage !== undefined && { sourceLanguage }),
      ...(targetLanguage !== undefined && { targetLanguage }),
      ...(autoplayDelaySourceToTarget !== undefined && {
        autoplayDelaySourceToTarget,
      }),
      ...(autoplayDelayTargetToNext !== undefined && { autoplayDelayTargetToNext }),
      ...(maxInitialLearningCards !== undefined && { maxInitialLearningCards }),
      ...(initialLearningReviewsRequired !== undefined && {
        initialLearningReviewsRequired,
      }),
      ...(initialLearningPriorityCoefficientReviewCount !== undefined && {
        initialLearningPriorityCoefficientReviewCount,
      }),
      ...(initialLearningPriorityCoefficientMinutes !== undefined && {
        initialLearningPriorityCoefficientMinutes,
      }),
      ...(initialLearningAutoplay !== undefined && { initialLearningAutoplay }),
    };

    if (prefs) {
      await ctx.db.patch(prefs._id, updates);
      return { ...prefs, ...updates };
    } else {
      // Create with defaults
      const id = await ctx.db.insert("user_preferences", {
        userId,
        sourceLanguage: sourceLanguage ?? "en",
        targetLanguage: targetLanguage ?? "es",
        autoplayDelaySourceToTarget: autoplayDelaySourceToTarget ?? 2000,
        autoplayDelayTargetToNext: autoplayDelayTargetToNext ?? 3000,
        maxInitialLearningCards: maxInitialLearningCards ?? 10,
        initialLearningReviewsRequired: initialLearningReviewsRequired ?? 4,
        initialLearningPriorityCoefficientReviewCount:
          initialLearningPriorityCoefficientReviewCount ?? 1.0,
        initialLearningPriorityCoefficientMinutes:
          initialLearningPriorityCoefficientMinutes ?? 0.1,
        initialLearningAutoplay: initialLearningAutoplay ?? false,
        updatedAt: Date.now(),
      });

      return {
        _id: id,
        userId,
        sourceLanguage: sourceLanguage ?? "en",
        targetLanguage: targetLanguage ?? "es",
        autoplayDelaySourceToTarget: autoplayDelaySourceToTarget ?? 2000,
        autoplayDelayTargetToNext: autoplayDelayTargetToNext ?? 3000,
        maxInitialLearningCards: maxInitialLearningCards ?? 10,
        initialLearningReviewsRequired: initialLearningReviewsRequired ?? 4,
        initialLearningPriorityCoefficientReviewCount:
          initialLearningPriorityCoefficientReviewCount ?? 1.0,
        initialLearningPriorityCoefficientMinutes:
          initialLearningPriorityCoefficientMinutes ?? 0.1,
        initialLearningAutoplay: initialLearningAutoplay ?? false,
        updatedAt: Date.now(),
      };
    }
  },
});

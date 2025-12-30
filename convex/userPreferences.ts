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
        autoplayDelayEnglishToSpanish: 2000,
        autoplayDelaySpanishToNext: 3000,
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
    autoplayDelayEnglishToSpanish: v.optional(v.number()),
    autoplayDelaySpanishToNext: v.optional(v.number()),
  },
  handler: async (ctx, { userId, autoplayDelayEnglishToSpanish, autoplayDelaySpanishToNext }) => {
    let prefs = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    const updates = {
      userId,
      updatedAt: Date.now(),
      ...(autoplayDelayEnglishToSpanish !== undefined && {
        autoplayDelayEnglishToSpanish,
      }),
      ...(autoplayDelaySpanishToNext !== undefined && { autoplayDelaySpanishToNext }),
    };

    if (prefs) {
      await ctx.db.patch(prefs._id, updates);
      return { ...prefs, ...updates };
    } else {
      // Create with defaults
      const id = await ctx.db.insert("user_preferences", {
        userId,
        autoplayDelayEnglishToSpanish: autoplayDelayEnglishToSpanish ?? 2000,
        autoplayDelaySpanishToNext: autoplayDelaySpanishToNext ?? 3000,
        updatedAt: Date.now(),
      });

      return {
        _id: id,
        userId,
        autoplayDelayEnglishToSpanish: autoplayDelayEnglishToSpanish ?? 2000,
        autoplayDelaySpanishToNext: autoplayDelaySpanishToNext ?? 3000,
        updatedAt: Date.now(),
      };
    }
  },
});

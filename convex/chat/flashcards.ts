import { v } from "convex/values";
import { mutation, query, internalMutation } from "../_generated/server";
import { authComponent } from "../auth";

/**
 * Internal mutation to create a flashcard for a specific user
 * Used by the agent tool handler
 */
export const createFlashcardInternal = internalMutation({
  args: {
    text: v.string(),
    note: v.string(),
    userId: v.string(),
  },
  returns: v.id("testFlashcards"),
  handler: async (ctx, args) => {
    // Generate date and random number
    const date = Date.now();
    const randomNumber = Math.floor(Math.random() * 1001); // 0-1000

    // Create the flashcard
    const flashcardId = await ctx.db.insert("testFlashcards", {
      text: args.text,
      note: args.note,
      date,
      randomNumber,
      userId: args.userId,
    });

    return flashcardId;
  },
});

/**
 * Create a new flashcard for the authenticated user
 */
export const createFlashcard = mutation({
  args: {
    text: v.string(),
    note: v.string(),
  },
  returns: v.id("testFlashcards"),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Not authenticated");
    }

    // Generate date and random number
    const date = Date.now();
    const randomNumber = Math.floor(Math.random() * 1001); // 0-1000

    // Create the flashcard
    const flashcardId = await ctx.db.insert("testFlashcards", {
      text: args.text,
      note: args.note,
      date,
      randomNumber,
      userId: user._id,
    });

    return flashcardId;
  },
});

/**
 * List all flashcards for the authenticated user
 */
export const listUserFlashcards = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("testFlashcards"),
      text: v.string(),
      note: v.string(),
      date: v.number(),
      randomNumber: v.number(),
      userId: v.string(),
      _creationTime: v.number(),
    })
  ),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    // Fetch all flashcards for this user, ordered by creation time (newest first)
    const flashcards = await ctx.db
      .query("testFlashcards")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .collect();

    return flashcards;
  },
});




import { v } from "convex/values";
import { query, internalMutation } from "../../_generated/server";
import { getAuthUser } from "../../db/users";

/**
 * Internal mutation to create a flashcard for a specific user.
 * Used by the approval flow after user approves.
 */
export const createFlashcardInternal = internalMutation({
  args: {
    text: v.string(),
    note: v.string(),
    userId: v.string(),
  },
  returns: v.id("testFlashcards"),
  handler: async (ctx, args) => {
    const date = Date.now();
    const randomNumber = Math.floor(Math.random() * 1001);

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
 * List all flashcards for the authenticated user.
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
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const flashcards = await ctx.db
      .query("testFlashcards")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .order("desc")
      .collect();

    return flashcards;
  },
});


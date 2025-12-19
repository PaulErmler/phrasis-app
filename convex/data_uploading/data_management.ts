import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";


// Upsert a sentence into the database
export const upsertSentence = mutation({
  args: {
    datasetSentenceId: v.number(),
    text: v.string(),
    language: v.string(),
    deck: v.string(),
    deckRank: v.number(),
    difficulty: v.string(),
    topic1: v.optional(v.string()),
    topic2: v.optional(v.string()),
  },
  returns: v.id("sentences"),
  handler: async (ctx, args) => {
    // Try to find existing sentence by datasetSentenceId
    const existing = await ctx.db
      .query("sentences")
      .withIndex("by_datasetSentenceId", (q) => 
        q.eq("datasetSentenceId", args.datasetSentenceId)
      )
      .unique();

    if (existing) {
      // Update existing sentence
      await ctx.db.patch(existing._id, {
        text: args.text,
        language: args.language,
        deck: args.deck,
        deckRank: args.deckRank,
        difficulty: args.difficulty,
        topic1: args.topic1,
        topic2: args.topic2,
      });
      return existing._id;
    } else {
      // Insert new sentence
      const id: Id<"sentences"> = await ctx.db.insert("sentences", {
        datasetSentenceId: args.datasetSentenceId,
        text: args.text,
        language: args.language,
        deck: args.deck,
        deckRank: args.deckRank,
        difficulty: args.difficulty,
        topic1: args.topic1,
        topic2: args.topic2,
      });
      return id;
    }
  },
});


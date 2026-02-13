import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// Upsert a collection into the database (internal - for seeding only)
export const upsertCollection = internalMutation({
  args: {
    name: v.string(),
  },
  returns: v.id("collections"),
  handler: async (ctx, args) => {
    // Try to find existing collection by name
    const existing = await ctx.db
      .query("collections")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();

    if (existing) {
      return existing._id;
    } else {
      // Insert new collection with textCount initialized to 0
      const id: Id<"collections"> = await ctx.db.insert("collections", {
        name: args.name,
        textCount: 0,
      });
      return id;
    }
  },
});


// Batch upsert texts into the database (internal - for seeding only)
// More efficient for bulk uploads - processes up to 500 texts at once
export const batchUpsertTexts = internalMutation({
  args: {
    texts: v.array(
      v.object({
        datasetSentenceId: v.number(),
        text: v.string(),
        language: v.string(),
        collectionId: v.id("collections"),
        collectionRank: v.number(),
      })
    ),
  },
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;

    // Group texts by collectionId to batch update textCount
    const collectionCounts: Map<Id<"collections">, number> = new Map();

    for (const textData of args.texts) {
      // Try to find existing text by datasetSentenceId
      const existing = await ctx.db
        .query("texts")
        .withIndex("by_datasetSentenceId", (q) =>
          q.eq("datasetSentenceId", textData.datasetSentenceId)
        )
        .unique();

      if (existing) {
        // Update existing text
        await ctx.db.patch(existing._id, {
          text: textData.text,
          language: textData.language,
          collectionId: textData.collectionId,
          collectionRank: textData.collectionRank,
        });
        updated++;
      } else {
        // Insert new text
        await ctx.db.insert("texts", {
          datasetSentenceId: textData.datasetSentenceId,
          text: textData.text,
          language: textData.language,
          userCreated: false,
          collectionId: textData.collectionId,
          collectionRank: textData.collectionRank,
        });
        inserted++;

        // Track count for this collection
        const currentCount = collectionCounts.get(textData.collectionId) || 0;
        collectionCounts.set(textData.collectionId, currentCount + 1);
      }
    }

    // Update textCount for each collection that had new inserts
    for (const [collectionId, count] of collectionCounts) {
      const collection = await ctx.db.get(collectionId);
      if (collection) {
        await ctx.db.patch(collectionId, {
          textCount: collection.textCount + count,
        });
      }
    }

    return { inserted, updated };
  },
});

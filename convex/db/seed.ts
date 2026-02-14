import { v } from "convex/values";
import { internalMutation, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

/**
 * Adjust a collection's textCount by a delta (positive or negative).
 */
export async function adjustCollectionTextCount(
  ctx: MutationCtx,
  collectionId: Id<"collections">,
  delta: number
) {
  if (delta === 0) return;
  const collection = await ctx.db.get(collectionId);
  if (!collection) return;
  await ctx.db.patch(collectionId, {
    textCount: Math.max(0, collection.textCount + delta),
  });
}

/**
 * Upsert a collection into the database (internal — for seeding only).
 */
export const upsertCollection = internalMutation({
  args: {
    name: v.string(),
  },
  returns: v.id("collections"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("collections")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();

    if (existing) {
      return existing._id;
    }

    const id: Id<"collections"> = await ctx.db.insert("collections", {
      name: args.name,
      textCount: 0,
    });
    return id;
  },
});

/**
 * Batch upsert texts into the database (internal — for seeding only).
 * Processes up to 500 texts at once.
 */
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

    for (const textData of args.texts) {
      const existing = await ctx.db
        .query("texts")
        .withIndex("by_datasetSentenceId", (q) =>
          q.eq("datasetSentenceId", textData.datasetSentenceId)
        )
        .unique();

      if (existing) {
        // If text is moving to a different collection, adjust both counts
        if (existing.collectionId && existing.collectionId !== textData.collectionId) {
          await adjustCollectionTextCount(ctx, existing.collectionId, -1);
          await adjustCollectionTextCount(ctx, textData.collectionId, +1);
        }

        await ctx.db.patch(existing._id, {
          text: textData.text,
          language: textData.language,
          collectionId: textData.collectionId,
          collectionRank: textData.collectionRank,
        });
        updated++;
      } else {
        await ctx.db.insert("texts", {
          datasetSentenceId: textData.datasetSentenceId,
          text: textData.text,
          language: textData.language,
          userCreated: false,
          collectionId: textData.collectionId,
          collectionRank: textData.collectionRank,
        });
        await adjustCollectionTextCount(ctx, textData.collectionId, +1);
        inserted++;
      }
    }

    return { inserted, updated };
  },
});


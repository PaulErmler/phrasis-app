import { v } from "convex/values";
import { query } from "./_generated/server";
import { authComponent } from "./auth";

// Get all collections (authenticated users only)
export const getCollections = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("collections"),
      _creationTime: v.number(),
      name: v.string(),
      textCount: v.number(),
    })
  ),
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const collections = await ctx.db.query("collections").collect();
    return collections;
  },
});

// Get texts for a collection with limit (authenticated users only)
export const getTextsByCollection = query({
  args: {
    collectionId: v.id("collections"),
    limit: v.number(),
  },
  returns: v.array(
    v.object({
      _id: v.id("texts"),
      _creationTime: v.number(),
      text: v.string(),
      language: v.string(),
      collectionRank: v.optional(v.number()),
    })
  ),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const textsQuery = ctx.db
      .query("texts")
      .withIndex("by_collection_and_rank", (q) =>
        q.eq("collectionId", args.collectionId)
      )
      .order("asc");

    const texts = await textsQuery.take(args.limit);

    return texts.map((t) => ({
      _id: t._id,
      _creationTime: t._creationTime,
      text: t.text,
      language: t.language,
      collectionRank: t.collectionRank,
    }));
  },
});

// Get all collections with their first N texts (authenticated users only)
export const getCollectionsWithTexts = query({
  args: {
    textsPerCollection: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("collections"),
      name: v.string(),
      texts: v.array(
        v.object({
          _id: v.id("texts"),
          text: v.string(),
          collectionRank: v.optional(v.number()),
        })
      ),
      textCount: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return [];
    }

    const limit = args.textsPerCollection ?? 5;
    const collections = await ctx.db.query("collections").collect();

    const result = await Promise.all(
      collections.map(async (collection) => {
        // Get first N texts ordered by rank
        const texts = await ctx.db
          .query("texts")
          .withIndex("by_collection_and_rank", (q) =>
            q.eq("collectionId", collection._id)
          )
          .order("asc")
          .take(limit);

        return {
          _id: collection._id,
          name: collection.name,
          texts: texts.map((t) => ({
            _id: t._id,
            text: t.text,
            collectionRank: t.collectionRank,
          })),
          // Use the pre-computed textCount from the collection
          textCount: collection.textCount,
        };
      })
    );

    // Sort by CEFR level order: Essential, A1, A2, B1, B2, C1, C2
    const levelOrder = ["Essential", "A1", "A2", "B1", "B2", "C1", "C2"];
    result.sort((a, b) => {
      const aIndex = levelOrder.indexOf(a.name);
      const bIndex = levelOrder.indexOf(b.name);
      if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return result;
  },
});

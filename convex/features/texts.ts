import { v } from "convex/values";
import { query } from "../_generated/server";
import { getAuthUser } from "../db/users";

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get all collections with their first N texts.
 */
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
    const user = await getAuthUser(ctx);
    if (!user) return [];

    const limit = args.textsPerCollection ?? 5;
    const collections = await ctx.db.query("collections").collect();

    const result = await Promise.all(
      collections.map(async (collection) => {
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
          textCount: collection.textCount,
        };
      })
    );

    // Sort by CEFR level order
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


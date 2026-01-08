import { query } from "./_generated/server";
import { v } from "convex/values";

export const getAllCardsWithLanguages = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const cards = await ctx.db
      .query("cards")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    return {
      total: cards.length,
      byLanguage: cards.reduce((acc: any, card) => {
        const lang = card.targetLanguage || "unknown";
        acc[lang] = (acc[lang] || 0) + 1;
        return acc;
      }, {}),
      recent: cards.slice(-5).map((c) => ({
        _id: c._id,
        targetLanguage: c.targetLanguage,
      })),
    };
  },
});

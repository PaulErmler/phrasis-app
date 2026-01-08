import { query } from "./_generated/server";
import { v } from "convex/values";

export const checkCardLanguages = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const cards = await ctx.db
      .query("cards")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    const languageCount: Record<string, number> = {};
    cards.forEach((card) => {
      const lang = card.targetLanguage || "undefined";
      languageCount[lang] = (languageCount[lang] || 0) + 1;
    });

    return {
      totalCards: cards.length,
      byLanguage: languageCount,
      recentCards: cards.slice(-10).map((c) => ({
        _id: c._id,
        targetLanguage: c.targetLanguage,
        sentenceId: c.sentenceId,
      })),
    };
  },
});

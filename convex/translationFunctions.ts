import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import axios from "axios";

// ------------------------
// Sentences
// ------------------------
export const findSentenceByText = query({
    args: { text: v.string() },
    handler: async (ctx, { text }) => {
      return await ctx.db
        .query("sentences")
        .withIndex("by_text", (q) => q.eq("text", text))
        .first(); // return the first match
    },
  });

export const insertSentence = mutation({
  args: { text: v.string(), language: v.string() },
  returns: v.id("sentences"),
  handler: async (ctx, { text, language }) => {
    return await ctx.db.insert("sentences",{
      text,
      language,
    });
  },
});

// ------------------------
// Translations
// ------------------------
export const findTranslation = query({
    args: {
      sentenceId: v.id("sentences"),
      targetLanguage: v.string(),
    },
    handler: async (ctx, { sentenceId, targetLanguage }) => {
      return await ctx.db
        .query("translations")
        .withIndex("by_sentence_and_language", (q) =>
          q.eq("sentenceId", sentenceId).eq("targetLanguage", targetLanguage)
        )
        .first();
    },
  });

    
export const insertTranslation = mutation({
  args: { sentenceId: v.id("sentences"), targetLanguage: v.string(), translatedText: v.string() },
  returns: v.id("translations"),
  handler: async (ctx, { sentenceId, targetLanguage, translatedText }) => {
    return await ctx.db.insert("translations",{
      sentenceId,
      targetLanguage,
      translatedText,
    });
  },
});



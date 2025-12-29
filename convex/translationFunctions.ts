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
      createdAt: Date.now(),
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
      createdAt: Date.now(),
    });
  },
});

// ------------------------
// Translation API call (Eden AI)
// ------------------------
export const translateText = action({
  args: { text: v.string(), sourceLang: v.string(), targetLang: v.string() },
  returns: v.object({ translatedText: v.string() }),
  handler: async (_ctx, { text, sourceLang, targetLang }) => {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) throw new Error("EDENAI_API_KEY not set");

    const response = await axios.post(
      "https://api.edenai.run/v2/translation/automatic_translation",
      {
        providers: "google",
        text,
        source_language: sourceLang,
        target_language: targetLang,
      },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    const translatedText = response.data?.google?.text;
    if (!translatedText) throw new Error("No translation returned from Eden AI");

    return { translatedText };
  },
});

// ------------------------
// Combined action: getOrTranslate
// ------------------------
export const getOrTranslate = action({
  args: { text: v.string(), sourceLang: v.string(), targetLang: v.string() },
  returns: v.object({ translatedText: v.string() }),
  handler: async (ctx, { text, sourceLang, targetLang }) => {
    
    let sentence:any = await ctx.runQuery(api.translationFunctions.findSentenceByText, { text });

    if (!sentence) {
        const sentenceId = await ctx.runMutation(api.translationFunctions.insertSentence, { text, language: sourceLang });
        console.log("written to database", sentenceId);
        // Wrap it in an object so you can use _id below
        sentence = { _id: sentenceId, text, language: sourceLang };
      }
    else{
      console.log("sentence in database", sentence);
    }
    let translation:any = await ctx.runQuery(api.translationFunctions.findTranslation, {
      sentenceId: sentence._id,
      targetLanguage: targetLang,
    });
    if (translation) return { translatedText: translation.translatedText };
    console.log("translation not in database")
    const { translatedText }:any = await ctx.runAction(api.translationFunctions.translateText, { text, sourceLang, targetLang });

    await ctx.runMutation(api.translationFunctions.insertTranslation, {
      sentenceId: sentence._id,
      targetLanguage: targetLang,
      translatedText,
    });

    return { translatedText };
  },
});

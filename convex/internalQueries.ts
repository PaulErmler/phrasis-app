import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// Internal query to get translation from database
export const getTranslation = internalQuery({
  args: {
    textId: v.id("texts"),
    targetLanguage: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("translations"),
      translatedText: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const translation = await ctx.db
      .query("translations")
      .withIndex("by_text_and_language", (q) => 
        q.eq("textId", args.textId).eq("targetLanguage", args.targetLanguage)
      )
      .first();
    
    if (!translation) {
      return null;
    }
    
    return {
      _id: translation._id,
      translatedText: translation.translatedText,
    };
  },
});

// Internal query to get audio recording from database
export const getAudioRecording = internalQuery({
  args: {
    textId: v.id("texts"),
    language: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id("audioRecordings"),
      url: v.string(),
      storageId: v.id("_storage"),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const recording = await ctx.db
      .query("audioRecordings")
      .withIndex("by_text_and_language", (q) => 
        q
          .eq("textId", args.textId)
          .eq("language", args.language)
      )
      .first();
    
    if (!recording) {
      return null;
    }
    
    return {
      _id: recording._id,
      url: recording.url,
      storageId: recording.storageId,
    };
  },
});

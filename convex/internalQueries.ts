import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// Internal query to get translation from database
export const getTranslation = internalQuery({
  args: {
    sentenceId: v.id("sentences"),
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
      .withIndex("by_sentence_and_language", (q) => 
        q.eq("sentenceId", args.sentenceId).eq("targetLanguage", args.targetLanguage)
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
    sentenceId: v.id("sentences"),
    language: v.string(),
    accent: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      _id: v.id("audio_recordings"),
      audioUrl: v.string(),
      audioData: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const recording = await ctx.db
      .query("audio_recordings")
      .withIndex("by_sentence_language_accent", (q) => 
        q
          .eq("sentenceId", args.sentenceId)
          .eq("language", args.language)
          .eq("accent", args.accent ?? undefined)
      )
      .first();
    
    if (!recording) {
      return null;
    }
    
    return {
      _id: recording._id,
      audioUrl: recording.audioUrl,
      audioData: recording.audioData,
    };
  },
});


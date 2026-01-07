import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import axios from "axios";

// ------------------------
// Queries
// ------------------------

export const findAudioRecording = query({
  args: {
    sentenceId: v.id("sentences"),
    language: v.string(),
  },
  handler: async (ctx, { sentenceId, language }) => {
    return ctx.db
      .query("audio_recordings")
      .withIndex("by_sentence_language", (q) =>
        q.eq("sentenceId", sentenceId).eq("language", language)
      )
      .first();
  },
});

// ------------------------
// Mutations
// ------------------------

export const insertAudioRecording = mutation({
  args: {
    sentenceId: v.id("sentences"),
    language: v.string(),
    storageId: v.id("_storage"),
  },
  returns: v.id("audio_recordings"),
  handler: async (ctx, args) => {
    return ctx.db.insert("audio_recordings", {
      ...args,
    });
  },
});

// ------------------------
// Actions
// ------------------------

export const generateSpeech = action({
  args: {
    text: v.string(),
    language: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, { text, language }) => {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) throw new Error("EDENAI_API_KEY not set");

    const response = await axios.post(
      "https://api.edenai.run/v2/audio/text_to_speech",
      {
        providers: "google",
        text,
        language,
        option: "FEMALE",
      },
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    const audioBase64 = response.data?.google?.audio;
    if (!audioBase64) throw new Error("No audio returned");

    return audioBase64;
  },
});

export const deleteAllAudioRecordings = mutation({
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("audio_recordings")
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }

    return { deleted: rows.length };
  },
});

export const getOrRecordAudio = action({
  args: {
    text: v.string(),
    language: v.string(),
    difficulty: v.optional(v.string()),
    datasetSentenceId: v.optional(v.number()),
    deck: v.optional(v.string()),
    deckRank: v.optional(v.number()),
    topic1: v.optional(v.string()),
    topic2: v.optional(v.string()),
  },
  returns: v.object({
    audioUrl: v.string(),
  }),
  
  handler: async (
    ctx,
    { text, language, difficulty, datasetSentenceId, deck, deckRank, topic1, topic2 }
  ): Promise<{ audioUrl: string }> => {
    console.log(`[getOrRecordAudio] Checking for existing audio for text: "${text}", language: "${language}"`);
    const sentence: { _id: Id<"sentences"> } | null =
      await ctx.runQuery(
        api.translationFunctions.findSentenceByText,
        { text }
      );
    let sentenceId: Id<"sentences">;

    if (sentence) {
      sentenceId = sentence._id;
    } else {
      sentenceId = await ctx.runMutation(
        api.translationFunctions.insertSentence,
        {
          datasetSentenceId: datasetSentenceId || 0,
          text: text,
          language: language,
          deck: deck || "unknown",
          deckRank: deckRank || 0,
          difficulty: difficulty || "Essential",
          topic1: topic1,
          topic2: topic2
        }
      );
    }
    const audio: { storageId: Id<"_storage"> } | null =
      await ctx.runQuery(
        api.audioFunctions.findAudioRecording,
        { sentenceId, language }
      );
    if (audio) {
      console.log(`[getOrRecordAudio] Audio found in database for text: "${text}", language: "${language}"`);
      const url: string | null = await ctx.storage.getUrl(audio.storageId);
      if (!url) throw new Error("Failed to load audio");
      console.log(`[getOrRecordAudio] Returning direct Convex storage URL: ${url}`);
      return { audioUrl: url };
    }
    console.log(`[getOrRecordAudio] Audio not found in database, generating new audio for text: "${text}", language: "${language}"`);
    const base64: string = await ctx.runAction(
      api.audioFunctions.generateSpeech,
      { text, language }
    );
    console.log(`[getOrRecordAudio] Audio generation successful for text: "${text}", language: "${language}"`);

    const audioBytes = Uint8Array.from(
      atob(base64),
      (c) => c.charCodeAt(0)
    );

    const storageId: Id<"_storage"> =
      await ctx.storage.store(
        new Blob([audioBytes.buffer], { type: "audio/mpeg" })
      );

    await ctx.runMutation(api.audioFunctions.insertAudioRecording, {
      sentenceId,
      language,
      storageId,
    });

    console.log(`[getOrRecordAudio] Audio stored successfully in database for text: "${text}", language: "${language}"`);
    const finalUrl: string | null = await ctx.storage.getUrl(storageId);
    if (!finalUrl) throw new Error("Failed to load audio");
    console.log(`[getOrRecordAudio] Returning direct Convex storage URL: ${finalUrl}`);
    return { audioUrl: finalUrl };
  },
});
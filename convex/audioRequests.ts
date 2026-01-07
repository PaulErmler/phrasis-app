import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

/**
 * Request audio generation (captures intent, returns immediately)
 * Schedules action to generate audio in background
 */
export const requestAudio = mutation({
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
  handler: async (ctx, { text, language, difficulty, datasetSentenceId, deck, deckRank, topic1, topic2 }) => {
    // Check if we already have this audio recording
    // We can fetch it from the audio_recordings table by looking up the sentence
    
    // For now, create a request entry
    const identity = await ctx.auth.getUserIdentity();
    const requestId = await ctx.db.insert("audio_requests", {
      userId: identity?.subject || "anonymous",
      text,
      language,
      status: "pending",
    });

    // Schedule action to generate audio in background (doesn't wait)
    await ctx.scheduler.runAfter(0, api.audioRequests.generateAudio, {
      requestId,
      text,
      language,
      difficulty: difficulty,
      datasetSentenceId: datasetSentenceId,
      deck: deck,
      deckRank: deckRank,
      topic1: topic1,
      topic2: topic2
    });

    return requestId;
  },
});

/**
 * Get audio request status and result
 */
export const getRequest = query({
  args: {
    requestId: v.id("audio_requests"),
  },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    return request;
  },
});

/**
 * Background action to generate audio
 */
export const generateAudio = action({
  args: {
    requestId: v.id("audio_requests"),
    text: v.string(),
    language: v.string(),
    difficulty: v.optional(v.string()),
    datasetSentenceId: v.optional(v.number()),
    deck: v.optional(v.string()),
    deckRank: v.optional(v.number()),
    topic1: v.optional(v.string()),
    topic2: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, text, language, difficulty, datasetSentenceId, deck, deckRank, topic1, topic2 }) => {
    try {
      // Call the audio generation action
      const result = await ctx.runAction(api.audioFunctions.getOrRecordAudio, {
        text,
        language,
        difficulty: difficulty || "Essential",
        datasetSentenceId: datasetSentenceId || 0,
        deck: deck || "unknown",
        deckRank: deckRank || 0,
        topic1: topic1,
        topic2: topic2,
      });

      if (result?.audioUrl) {
        // Update request with completion status
        await ctx.runMutation(api.audioRequests.updateRequest, {
          requestId,
          status: "completed",
          audioUrl: result.audioUrl,
        });
      } else {
        await ctx.runMutation(api.audioRequests.updateRequest, {
          requestId,
          status: "failed",
        });
      }
    } catch (error) {
      console.error("Error generating audio:", error);
      await ctx.runMutation(api.audioRequests.updateRequest, {
        requestId,
        status: "failed",
      });
    }
  },
});

/**
 * Update audio request status (internal use by background action)
 */
export const updateRequest = mutation({
  args: {
    requestId: v.id("audio_requests"),
    status: v.string(),
    audioUrl: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, status, audioUrl }) => {
    const updateData: Record<string, string> = { status };
    if (audioUrl) {
      updateData.audioUrl = audioUrl;
    }
    await ctx.db.patch(requestId, updateData);
  },
});

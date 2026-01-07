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
  },
  handler: async (ctx, { text, language }) => {
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
  },
  handler: async (ctx, { requestId, text, language }) => {
    try {
      // Call the audio generation action
      const result = await ctx.runAction(api.audioFunctions.getOrRecordAudio, {
        text,
        language,
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

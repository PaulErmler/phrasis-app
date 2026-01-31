import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { MAX_TTS_LENGTH, MIN_TTS_SPEED, MAX_TTS_SPEED } from "../lib/constants/tts";
import { authComponent } from "./auth";
import { Id } from "./_generated/dataModel";

/** Google TTS API response type */
interface GoogleTTSResponse {
  audioContent: string; // Base64-encoded audio
}

/**
 * Extract languageCode from voiceName (e.g., "en-US-Chirp3-HD-Leda" -> "en-US")
 */
function extractLanguageCode(voiceName: string): string {
  return voiceName.split("-Chirp3-HD-")[0];
}

/**
 * Request TTS audio generation. Creates a pending request and schedules processing.
 */
export const requestTTS = mutation({
  args: {
    text: v.string(),
    voiceName: v.string(), // e.g., "en-US-Chirp3-HD-Leda"
    speed: v.number(), // speaking_rate: 0.5 to 1.0
  },
  returns: v.id("ttsRequests"),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new Error("Unauthenticated");
    }

    // Validate text
    const text = args.text.trim();
    if (!text) {
      throw new Error("Text cannot be empty");
    }
    if (text.length > MAX_TTS_LENGTH) {
      throw new Error(`Text exceeds maximum length of ${MAX_TTS_LENGTH} characters`);
    }

    if (args.speed < MIN_TTS_SPEED || args.speed > MAX_TTS_SPEED) {
      throw new Error(`Invalid speed. Must be between ${MIN_TTS_SPEED} and ${MAX_TTS_SPEED}`);
    }

    // Create pending request
    const requestId = await ctx.db.insert("ttsRequests", {
      userId: user._id,
      text,
      voiceName: args.voiceName,
      speed: args.speed,
      status: "pending",
      createdAt: Date.now(),
    });

    // Schedule the TTS processing
    await ctx.scheduler.runAfter(0, internal.tts.processTTS, {
      requestId,
    });

    return requestId;
  },
});

/**
 * Get a TTS request by ID. Generates audioUrl dynamically from storageId.
 */
export const getTTSRequest = query({
  args: {
    requestId: v.id("ttsRequests"),
  },
  returns: v.union(
    v.object({
      _id: v.id("ttsRequests"),
      _creationTime: v.number(),
      userId: v.string(),
      text: v.string(),
      voiceName: v.string(),
      speed: v.number(),
      status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
      storageId: v.optional(v.id("_storage")),
      audioUrl: v.optional(v.string()),
      error: v.optional(v.string()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return null;
    }

    const request = await ctx.db.get(args.requestId);
    if (!request || request.userId !== user._id) {
      return null;
    }

    // Generate audioUrl dynamically from storageId
    const audioUrl = request.storageId 
      ? await ctx.storage.getUrl(request.storageId) 
      : undefined;

    return { ...request, audioUrl: audioUrl ?? undefined };
  },
});

/**
 * Internal query to get a request (used by the action).
 */
export const getRequestInternal = internalQuery({
  args: {
    requestId: v.id("ttsRequests"),
  },
  returns: v.union(
    v.object({
      text: v.string(),
      voiceName: v.string(),
      speed: v.number(),
      status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) {
      return null;
    }
    return {
      text: request.text,
      voiceName: request.voiceName,
      speed: request.speed,
      status: request.status,
    };
  },
});

/**
 * Internal mutation to update a TTS request with the result.
 */
export const updateRequestResult = internalMutation({
  args: {
    requestId: v.id("ttsRequests"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    storageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      status: args.status,
      storageId: args.storageId,
      error: args.error,
      completedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Internal action to process a TTS request using Google Cloud TTS REST API.
 */
export const processTTS = internalAction({
  args: {
    requestId: v.id("ttsRequests"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Load the request
    const request = await ctx.runQuery(internal.tts.getRequestInternal, {
      requestId: args.requestId,
    });

    if (!request || request.status !== "pending") {
      return null;
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.tts.updateRequestResult, {
        requestId: args.requestId,
        status: "failed",
        error: "TTS service not configured. Set GOOGLE_TTS_API_KEY.",
      });
      return null;
    }

    try {
      // Extract languageCode from voiceName
      const languageCode = extractLanguageCode(request.voiceName);

      // Build the request body for Google TTS API
      const requestBody = {
        input: {
          text: request.text,
        },
        voice: {
          languageCode,
          name: request.voiceName,
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: request.speed,
        },
      };

      // Call Google Cloud TTS REST API
      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as GoogleTTSResponse;
      const audioContent = data.audioContent;

      if (!audioContent) {
        throw new Error("No audio content returned from Google TTS API");
      }

      // Decode base64 to binary and store in Convex storage
      const blob = new Blob([Uint8Array.from(atob(audioContent), c => c.charCodeAt(0))], {
        type: 'audio/mp3',
      });
      
      // Store in Convex storage
      const storageId: Id<"_storage"> = await ctx.storage.store(blob);

      await ctx.runMutation(internal.tts.updateRequestResult, {
        requestId: args.requestId,
        status: "completed",
        storageId,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("TTS error:", errorMessage);

      await ctx.runMutation(internal.tts.updateRequestResult, {
        requestId: args.requestId,
        status: "failed",
        error: "TTS generation failed. Please try again.",
      });
    }

    return null;
  },
});

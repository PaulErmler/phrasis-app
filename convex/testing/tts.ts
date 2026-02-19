import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAX_TTS_LENGTH, MIN_TTS_SPEED, MAX_TTS_SPEED } from "../../lib/constants/tts";
import { SUPPORTED_LANGUAGES } from "../../lib/languages";
import { getAuthUser, requireAuthUser } from "../db/users";
import { Id } from "../_generated/dataModel";
import { synthesizeSpeech } from "../features/tts";

/** Set of all valid voice API codes from SUPPORTED_LANGUAGES */
const VALID_VOICE_CODES = new Set(
  SUPPORTED_LANGUAGES.flatMap((lang) => lang.voices.map((v) => v.apiCode))
);

// ============================================================================
// PUBLIC API (testing page)
// ============================================================================

/**
 * Request TTS audio generation. Creates a pending request and schedules processing.
 */
export const requestTTS = mutation({
  args: {
    text: v.string(),
    voiceName: v.string(),
    speed: v.number(),
  },
  returns: v.id("ttsRequests"),
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);

    const text = args.text.trim();
    if (!text) throw new ConvexError("Text cannot be empty");
    if (text.length > MAX_TTS_LENGTH) {
      throw new ConvexError(`Text exceeds maximum length of ${MAX_TTS_LENGTH} characters`);
    }
    if (args.speed < MIN_TTS_SPEED || args.speed > MAX_TTS_SPEED) {
      throw new ConvexError(`Invalid speed. Must be between ${MIN_TTS_SPEED} and ${MAX_TTS_SPEED}`);
    }
    if (!VALID_VOICE_CODES.has(args.voiceName)) {
      throw new ConvexError("Invalid voice name. Must be a supported voice.");
    }

    const requestId = await ctx.db.insert("ttsRequests", {
      userId: user._id,
      text,
      voiceName: args.voiceName,
      speed: args.speed,
      status: "pending",
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.testing.tts.processTTS, { requestId });

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
    const user = await getAuthUser(ctx);
    if (!user) return null;

    const request = await ctx.db.get(args.requestId);
    if (!request || request.userId !== user._id) return null;

    const audioUrl = request.storageId
      ? await ctx.storage.getUrl(request.storageId)
      : undefined;

    return { ...request, audioUrl: audioUrl ?? undefined };
  },
});

// ============================================================================
// INTERNAL FUNCTIONS
// ============================================================================

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
    if (!request) return null;
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
 * Internal action to process a TTS request.
 */
export const processTTS = internalAction({
  args: {
    requestId: v.id("ttsRequests"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.testing.tts.getRequestInternal, {
      requestId: args.requestId,
    });

    if (!request || request.status !== "pending") return null;

    try {
      const blob = await synthesizeSpeech(request.text, request.voiceName, request.speed);
      const storageId: Id<"_storage"> = await ctx.storage.store(blob);

      await ctx.runMutation(internal.testing.tts.updateRequestResult, {
        requestId: args.requestId,
        status: "completed",
        storageId,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("TTS error:", errorMessage);

      await ctx.runMutation(internal.testing.tts.updateRequestResult, {
        requestId: args.requestId,
        status: "failed",
        error: "TTS generation failed. Please try again.",
      });
    }

    return null;
  },
});


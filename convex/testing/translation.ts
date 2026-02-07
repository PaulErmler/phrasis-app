import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAX_TRANSLATION_LENGTH } from "../../lib/constants/translation";
import { SUPPORTED_LANGUAGES } from "../../lib/languages";
import { getAuthUser } from "../db/users";
import { translateText } from "../features/translation";

/** Set of all valid language codes from SUPPORTED_LANGUAGES */
const VALID_LANGUAGE_CODES = new Set(
  SUPPORTED_LANGUAGES.map((lang) => lang.code)
);

// ============================================================================
// PUBLIC API (testing page)
// ============================================================================

/**
 * Request a translation. Creates a pending request and schedules processing.
 */
export const requestTranslation = mutation({
  args: {
    text: v.string(),
    sourceLang: v.string(),
    targetLang: v.string(),
  },
  returns: v.id("translationRequests"),
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    if (!user) throw new ConvexError("Unauthenticated");

    const text = args.text.trim();
    if (!text) throw new ConvexError("Text cannot be empty");
    if (text.length > MAX_TRANSLATION_LENGTH) {
      throw new ConvexError(`Text exceeds maximum length of ${MAX_TRANSLATION_LENGTH} characters`);
    }
    if (!VALID_LANGUAGE_CODES.has(args.sourceLang)) {
      throw new ConvexError("Invalid source language. Must be a supported language.");
    }
    if (!VALID_LANGUAGE_CODES.has(args.targetLang)) {
      throw new ConvexError("Invalid target language. Must be a supported language.");
    }
    if (args.sourceLang === args.targetLang) {
      throw new ConvexError("Source and target languages cannot be the same");
    }

    const requestId = await ctx.db.insert("translationRequests", {
      userId: user._id,
      text,
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      status: "pending",
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.testing.translation.processTranslation, {
      requestId,
    });

    return requestId;
  },
});

/**
 * Get a translation request by ID.
 */
export const getTranslationRequest = query({
  args: {
    requestId: v.id("translationRequests"),
  },
  returns: v.union(
    v.object({
      _id: v.id("translationRequests"),
      _creationTime: v.number(),
      userId: v.string(),
      text: v.string(),
      sourceLang: v.string(),
      targetLang: v.string(),
      status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
      result: v.optional(v.string()),
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

    return request;
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
    requestId: v.id("translationRequests"),
  },
  returns: v.union(
    v.object({
      text: v.string(),
      sourceLang: v.string(),
      targetLang: v.string(),
      status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return null;
    return {
      text: request.text,
      sourceLang: request.sourceLang,
      targetLang: request.targetLang,
      status: request.status,
    };
  },
});

/**
 * Internal mutation to update a translation request with the result.
 */
export const updateRequestResult = internalMutation({
  args: {
    requestId: v.id("translationRequests"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.requestId, {
      status: args.status,
      result: args.result,
      error: args.error,
      completedAt: Date.now(),
    });
  },
});

/**
 * Internal action to process a translation request.
 */
export const processTranslation = internalAction({
  args: {
    requestId: v.id("translationRequests"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.runQuery(internal.testing.translation.getRequestInternal, {
      requestId: args.requestId,
    });

    if (!request || request.status !== "pending") return null;

    try {
      const translation = await translateText(request.text, request.sourceLang, request.targetLang);

      await ctx.runMutation(internal.testing.translation.updateRequestResult, {
        requestId: args.requestId,
        status: "completed",
        result: translation,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Translation error:", errorMessage);

      await ctx.runMutation(internal.testing.translation.updateRequestResult, {
        requestId: args.requestId,
        status: "failed",
        error: "Translation failed. Please try again.",
      });
    }

    return null;
  },
});


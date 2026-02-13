import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { MAX_TRANSLATION_LENGTH } from "../lib/constants/translation";
import { authComponent } from "./auth";

/** Google Translation API response type */
interface GoogleTranslateResponse {
  data: {
    translations: Array<{
      translatedText: string;
    }>;
  };
}

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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }

    // Validate text
    const text = args.text.trim();
    if (!text) {
      throw new ConvexError("Text cannot be empty");
    }
    if (text.length > MAX_TRANSLATION_LENGTH) {
      throw new ConvexError(`Text exceeds maximum length of ${MAX_TRANSLATION_LENGTH} characters`);
    }

    if (args.sourceLang === args.targetLang) {
      throw new ConvexError("Source and target languages cannot be the same");
    }

    // Create pending request
    const requestId = await ctx.db.insert("translationRequests", {
      userId: user._id,
      text,
      sourceLang: args.sourceLang,
      targetLang: args.targetLang,
      status: "pending",
      createdAt: Date.now(),
    });

    // Schedule the translation processing
    await ctx.scheduler.runAfter(0, internal.translation.processTranslation, {
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
    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      return null;
    }

    const request = await ctx.db.get(args.requestId);
    if (!request || request.userId !== user._id) {
      return null;
    }

    return request;
  },
});

/**
 * Internal action to process a translation request using Google Cloud Translation REST API.
 */
export const processTranslation = internalAction({
  args: {
    requestId: v.id("translationRequests"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Load the request
    const request = await ctx.runQuery(internal.translation.getRequestInternal, {
      requestId: args.requestId,
    });

    if (!request || request.status !== "pending") {
      return null;
    }

    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.translation.updateRequestResult, {
        requestId: args.requestId,
        status: "failed",
        error: "Translation service not configured",
      });
      return null;
    }

    try {
      // Call Google Cloud Translation REST API v2
      const response = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: request.text,
            source: request.sourceLang,
            target: request.targetLang,
            format: "text",
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new ConvexError(`Google API error: ${response.status} - ${errorText}`);
      }

      const data = (await response.json()) as GoogleTranslateResponse;
      const translation = data.data?.translations?.[0]?.translatedText;

      if (!translation) {
        throw new ConvexError("No translation returned from Google API");
      }

      await ctx.runMutation(internal.translation.updateRequestResult, {
        requestId: args.requestId,
        status: "completed",
        result: translation,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      console.error("Translation error:", errorMessage);

      await ctx.runMutation(internal.translation.updateRequestResult, {
        requestId: args.requestId,
        status: "failed",
        error: "Translation failed. Please try again.",
      });
    }

    return null;
  },
});

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
    if (!request) {
      return null;
    }
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

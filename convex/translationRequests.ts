import { mutation, query, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

/**
 * Request translation (captures intent, returns immediately)
 * Schedules action to translate in background
 */
export const requestTranslation = mutation({
  args: {
    sourceText: v.string(),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
  },
  handler: async (ctx, { sourceText, sourceLanguage, targetLanguage }) => {
    // Create a request entry
    const identity = await ctx.auth.getUserIdentity();
    const requestId = await ctx.db.insert("translation_requests", {
      userId: identity?.subject || "anonymous",
      sourceText,
      sourceLanguage,
      targetLanguage,
      status: "pending",
    });

    // Schedule action to translate in background (doesn't wait)
    await ctx.scheduler.runAfter(0, api.translationRequests.translateInBackground, {
      requestId,
      sourceText,
      sourceLanguage,
      targetLanguage,
    });

    return requestId;
  },
});

/**
 * Get translation request status and result
 */
export const getRequest = query({
  args: {
    requestId: v.id("translation_requests"),
  },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    return request;
  },
});

/**
 * Background action to translate text
 */
export const translateInBackground = action({
  args: {
    requestId: v.id("translation_requests"),
    sourceText: v.string(),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
  },
  handler: async (ctx, { requestId, sourceText, sourceLanguage, targetLanguage }) => {
    try {
      // Call the translation action
      const result = await ctx.runAction(api.translation.translateText, {
        text: sourceText,
        sourceLang: sourceLanguage,
        targetLang: targetLanguage,
      });

      if (result?.translatedText) {
        // Update request with completion status
        await ctx.runMutation(api.translationRequests.updateRequest, {
          requestId,
          status: "completed",
          translatedText: result.translatedText,
        });
      } else {
        await ctx.runMutation(api.translationRequests.updateRequest, {
          requestId,
          status: "failed",
        });
      }
    } catch (error) {
      console.error("Error translating text:", error);
      await ctx.runMutation(api.translationRequests.updateRequest, {
        requestId,
        status: "failed",
      });
    }
  },
});

/**
 * Update translation request status (internal use by background action)
 */
export const updateRequest = mutation({
  args: {
    requestId: v.id("translation_requests"),
    status: v.string(),
    translatedText: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, status, translatedText }) => {
    await ctx.db.patch(requestId, {
      status,
      ...(translatedText && { translatedText }),
    });
  },
});

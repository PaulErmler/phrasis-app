import { v } from "convex/values";
import { mutation, action, query } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * Request card import - creates request and schedules import in background
 */
export const requestCardImport = mutation({
  args: {
    userId: v.string(),
    count: v.number(),
    sourceLanguage: v.optional(v.string()),
    targetLanguage: v.optional(v.string()),
    dataset: v.optional(v.string()),
  },
  handler: async (ctx, { userId, count, sourceLanguage = "en", targetLanguage = "es", dataset = "Essential" }) => {
    const requestId = await ctx.db.insert("card_import_requests", {
      userId,
      count,
      sourceLanguage,
      targetLanguage,
      status: "pending",
    });

    // Schedule the import action to run after this mutation completes
    await ctx.scheduler.runAfter(0, api.cardImportRequests.performImport, {
      requestId,
      userId,
      count,
      sourceLanguage,
      targetLanguage,
      dataset,
    });

    return requestId;
  },
});

/**
 * Perform the actual import - scheduled by requestCardImport
 */
export const performImport = action({
  args: {
    requestId: v.id("card_import_requests"),
    userId: v.string(),
    count: v.number(),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    dataset: v.string(),
  },
  handler: async (ctx, { requestId, userId, count, sourceLanguage = "en", targetLanguage = "es", dataset }) => {
    try {
      // Call the actual card import action
      await ctx.runAction(api.cardImporter.importCardsFromDataset, {
        userId,
        count,
        sourceLanguage,
        targetLanguage,
        dataset,
      });

      // Update request status
      await ctx.runMutation(api.cardImportRequests.updateRequest, {
        requestId,
        status: "completed",
      });
    } catch (error: any) {
      await ctx.runMutation(api.cardImportRequests.updateRequest, {
        requestId,
        status: "failed",
        error: error.message || String(error),
      });
    }
  },
});

/**
 * Update import request status
 */
export const updateRequest = mutation({
  args: {
    requestId: v.id("card_import_requests"),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, status, error }) => {
    await ctx.db.patch(requestId, {
      status,
      error,
    });
  },
});

/**
 * Get import request status
 */
export const getRequest = query({
  args: { requestId: v.id("card_import_requests") },
  handler: async (ctx, { requestId }) => {
    return await ctx.db.get(requestId);
  },
});

/**
 * Get latest import request for user
 */
export const getLatestRequest = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const requests = await ctx.db
      .query("card_import_requests")
      .withIndex("by_userId_status", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1);

    return requests[0] || null;
  },
});

/**
 * Get all available CSV datasets
 */
export const getAvailableDatasets = query({
  args: {},
  handler: async (ctx) => {
    const csvFiles = await ctx.db
      .query("csv_files")
      .order("desc")
      .collect();

    return csvFiles.map((file) => ({
      id: file._id,
      name: file.name,
      uploadedAt: file.uploadedAt,
    }));
  },
});

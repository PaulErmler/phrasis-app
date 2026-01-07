import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

/**
 * Request card import - captures intent by scheduling action
 * Client calls this mutation, mutation schedules the action server-side
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
    // Schedule the import action to run in background
    // This captures the intent - the cards appearing in DB is the signal of completion
    await ctx.scheduler.runAfter(0, api.cardImporter.importCardsFromDataset, {
      userId,
      count,
      sourceLanguage,
      targetLanguage,
      dataset,
    });
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

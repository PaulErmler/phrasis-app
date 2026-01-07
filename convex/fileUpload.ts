/**
 * File upload API for storing CSV files in Convex storage
 * Allows uploading sentence CSV files for use in the app
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";


/**
 * Get CSV file metadata by name
 */
export const getCSVFile = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return await ctx.db
      .query("csv_files")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
  },
});

/**
 * List all uploaded CSV files
 */
export const listCSVFiles = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("csv_files").collect();
  },
});

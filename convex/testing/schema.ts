import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Tables used only by testing / experimental features.
 * Spread into the main schema via `...testingTables`.
 */
export const testingTables = {
  // Translation requests table — async translation processing (testing UI)
  translationRequests: defineTable({
    userId: v.string(),
    text: v.string(),
    sourceLang: v.string(),
    targetLang: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_status', ['userId', 'status']),

  // TTS requests table — async TTS audio generation (testing UI)
  ttsRequests: defineTable({
    userId: v.string(),
    text: v.string(),
    voiceName: v.string(),
    speed: v.number(),
    status: v.union(
      v.literal('pending'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    storageId: v.optional(v.id('_storage')),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_status', ['userId', 'status']),
};

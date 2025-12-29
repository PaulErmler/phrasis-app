import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
  
  sentences: defineTable({
    text: v.string(),
    language: v.string(), // e.g., "en"
    createdAt: v.number(), // timestamp
  }).index("by_text", ["text"]),
  
  translations: defineTable({
    sentenceId: v.id("sentences"),
    targetLanguage: v.string(), // e.g., "es"
    translatedText: v.string(),
    createdAt: v.number(), // timestamp
  }).index("by_sentence_and_language", ["sentenceId", "targetLanguage"]),
  
  audio_recordings: defineTable({
    sentenceId: v.id("sentences"),
    language: v.string(), // e.g., "en-US"
    //accent: v.optional(v.string()), // e.g., "us", "uk"
    voice: v.optional(v.string()), // e.g., "FEMALE"
    //audioData: v.optional(v.string()), // base64
    storageId: v.id("_storage"),
    createdAt: v.number(), // timestamp
  }).index("by_sentence_language", ["sentenceId", "language"]),// "accent"]),
});

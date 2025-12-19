import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// The schema is entirely optional.
// You can delete this file (schema.ts) and the
// app will continue to work.
// The schema provides more precise TypeScript types.
export default defineSchema({
  numbers: defineTable({
    value: v.number(),
  }),
  
  // Sentences table - stores the original sentences
  sentences: defineTable({
    text: v.string(),
    language: v.string(), // e.g., "en" for English
  }).index("by_text", ["text"]),
  
  // Translations table - stores translations of sentences
  translations: defineTable({
    sentenceId: v.id("sentences"),
    targetLanguage: v.string(), // e.g., "es" for Spanish
    translatedText: v.string(),
  })
    .index("by_sentence_and_language", ["sentenceId", "targetLanguage"]),
  
  // Audio recordings table - stores audio data for sentences
  audio_recordings: defineTable({
    sentenceId: v.id("sentences"),
    language: v.string(), // e.g., "en-US" or "es-ES"
    accent: v.optional(v.string()), // e.g., "us", "uk", "mx"
    audioData: v.string(), // Base64 encoded audio
    audioUrl: v.string(), // Data URL for playing
  })
    .index("by_sentence_language_accent", ["sentenceId", "language", "accent"]),
});

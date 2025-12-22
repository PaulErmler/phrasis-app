import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { learningStyleValidator, currentLevelValidator } from "./types";

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
    datasetSentenceId: v.number(), // Unique ID from the dataset
    text: v.string(),
    language: v.string(), // e.g., "en" for English
    deck: v.string(), // Difficulty level: A1, A2, B1, B2, C1, C2
    deckRank: v.number(), // Rank within the deck
    difficulty: v.string(), // Difficulty as a string (e.g., "A1")
    topic1: v.optional(v.string()), // Primary topic
    topic2: v.optional(v.string()), // Secondary topic
  })
    .index("by_text", ["text"])
    .index("by_datasetSentenceId", ["datasetSentenceId"])
    .index("by_deck", ["deck", "deckRank"])
    .index("by_difficulty", ["difficulty"]),
  
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

  // User settings table - stores user preferences and onboarding status
  userSettings: defineTable({
    userId: v.string(), // Links to auth user
    hasCompletedOnboarding: v.boolean(),
    learningStyle: v.optional(learningStyleValidator),
    currentLevel: v.optional(currentLevelValidator),
    activeCourseId: v.optional(v.id("courses")), // Active course for the user
  }).index("by_userId", ["userId"]),

  // Onboarding progress table - stores temporary onboarding data until completion
  onboardingProgress: defineTable({
    userId: v.string(), // Links to auth user
    step: v.number(), // Current step in onboarding (1-6)
    learningStyle: v.optional(learningStyleValidator),
    currentLevel: v.optional(currentLevelValidator),
    targetLanguages: v.optional(v.array(v.string())),
    baseLanguages: v.optional(v.array(v.string())),
  }).index("by_userId", ["userId"]),


  // Courses table - stores user language learning courses
  courses: defineTable({
    userId: v.string(), // Links to auth user
    baseLanguages: v.array(v.string()), // ISO codes (e.g., ["en"])
    targetLanguages: v.array(v.string()), // ISO codes (e.g., ["es", "fr"])
    courseSettingsId: v.optional(v.id("courseSettings")),
  }).index("by_userId", ["userId"]),

  // Course settings table - stores course-specific settings
  courseSettings: defineTable({
    courseId: v.id("courses"),
  }).index("by_courseId", ["courseId"]),
});
